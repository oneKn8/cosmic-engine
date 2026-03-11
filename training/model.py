"""
MIDI Transformer -- a small GPT-2-style causal language model for MIDI token
sequences, with optional mood conditioning.

Architecture choices:
  - Pre-norm transformer decoder blocks (LayerNorm -> Attn -> Res, LN -> FFN -> Res)
  - Rotary positional embeddings (RoPE) for better length generalization
  - Uses PyTorch scaled_dot_product_attention (FlashAttention kernel when available)
  - ~35M parameters with default config (512 dim, 8 layers, 8 heads)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F


# ============================================================================
# Config
# ============================================================================

@dataclass
class MidiTransformerConfig:
    """All hyper-parameters for the model in one place."""

    vocab_size: int = 512
    d_model: int = 512
    n_heads: int = 8
    n_layers: int = 8
    d_ff: int = 2048
    max_seq_len: int = 1024
    dropout: float = 0.1
    n_moods: int = 8
    use_mood_conditioning: bool = True

    def __post_init__(self) -> None:
        assert self.d_model % self.n_heads == 0, (
            f"d_model ({self.d_model}) must be divisible by n_heads ({self.n_heads})"
        )


# ============================================================================
# Rotary Positional Embedding (RoPE)
# ============================================================================

def _precompute_freqs_cis(dim: int, max_seq_len: int, theta: float = 10000.0) -> torch.Tensor:
    """Pre-compute the complex exponential frequencies for RoPE."""
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 2).float() / dim))
    t = torch.arange(max_seq_len, dtype=torch.float32)
    freqs = torch.outer(t, freqs)  # (max_seq_len, dim//2)
    return torch.polar(torch.ones_like(freqs), freqs)  # complex64


def _apply_rotary_emb(
    xq: torch.Tensor,
    xk: torch.Tensor,
    freqs_cis: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Apply rotary embeddings to query and key tensors.

    Args:
        xq: Query tensor of shape (B, n_heads, T, head_dim).
        xk: Key tensor of shape (B, n_heads, T, head_dim).
        freqs_cis: Pre-computed frequencies of shape (T, head_dim//2).

    Returns:
        Rotated (xq, xk), same shapes as inputs.
    """
    # Reshape to complex: last dim pairs -> complex numbers
    # (B, H, T, D) -> (B, H, T, D/2, 2) -> complex (B, H, T, D/2)
    xq_c = torch.view_as_complex(xq.float().reshape(*xq.shape[:-1], -1, 2))
    xk_c = torch.view_as_complex(xk.float().reshape(*xk.shape[:-1], -1, 2))

    # freqs_cis shape: (T, D/2) -> (1, 1, T, D/2) for broadcast
    freqs = freqs_cis[None, None, :xq_c.shape[2], :]

    xq_out = torch.view_as_real(xq_c * freqs).flatten(-2)
    xk_out = torch.view_as_real(xk_c * freqs).flatten(-2)
    return xq_out.to(xq.dtype), xk_out.to(xk.dtype)


# ============================================================================
# Transformer Building Blocks
# ============================================================================

class CausalSelfAttention(nn.Module):
    """Multi-head causal self-attention with RoPE and SDPA."""

    def __init__(self, config: MidiTransformerConfig) -> None:
        super().__init__()
        self.n_heads = config.n_heads
        self.head_dim = config.d_model // config.n_heads

        self.qkv_proj = nn.Linear(config.d_model, 3 * config.d_model, bias=False)
        self.out_proj = nn.Linear(config.d_model, config.d_model, bias=False)
        self.attn_dropout = config.dropout
        self.resid_dropout = nn.Dropout(config.dropout)

    def forward(
        self,
        x: torch.Tensor,
        freqs_cis: torch.Tensor,
    ) -> torch.Tensor:
        B, T, C = x.shape

        qkv = self.qkv_proj(x)  # (B, T, 3*C)
        q, k, v = qkv.split(C, dim=-1)

        # (B, T, C) -> (B, n_heads, T, head_dim)
        q = q.view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        k = k.view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        v = v.view(B, T, self.n_heads, self.head_dim).transpose(1, 2)

        # Apply RoPE to q and k
        q, k = _apply_rotary_emb(q, k, freqs_cis)

        # Scaled dot-product attention (uses FlashAttention kernel when available)
        dropout_p = self.attn_dropout if self.training else 0.0
        out = F.scaled_dot_product_attention(
            q, k, v, is_causal=True, dropout_p=dropout_p,
        )

        # (B, n_heads, T, head_dim) -> (B, T, C)
        out = out.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_dropout(self.out_proj(out))


class FeedForward(nn.Module):
    """Position-wise feed-forward with GELU activation."""

    def __init__(self, config: MidiTransformerConfig) -> None:
        super().__init__()
        self.fc1 = nn.Linear(config.d_model, config.d_ff, bias=False)
        self.fc2 = nn.Linear(config.d_ff, config.d_model, bias=False)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.dropout(self.fc2(F.gelu(self.fc1(x))))


class TransformerBlock(nn.Module):
    """Pre-norm transformer decoder block."""

    def __init__(self, config: MidiTransformerConfig) -> None:
        super().__init__()
        self.ln1 = nn.LayerNorm(config.d_model)
        self.attn = CausalSelfAttention(config)
        self.ln2 = nn.LayerNorm(config.d_model)
        self.ffn = FeedForward(config)

    def forward(self, x: torch.Tensor, freqs_cis: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x), freqs_cis)
        x = x + self.ffn(self.ln2(x))
        return x


# ============================================================================
# Main Model
# ============================================================================

class MidiTransformer(nn.Module):
    """GPT-2-style causal transformer for MIDI token generation.

    Supports optional mood conditioning via a learned mood embedding that is
    added to every token embedding in the sequence.
    """

    def __init__(self, config: MidiTransformerConfig) -> None:
        super().__init__()
        self.config = config

        # Token embedding (no learned positional embedding -- we use RoPE)
        self.tok_emb = nn.Embedding(config.vocab_size, config.d_model)
        self.emb_dropout = nn.Dropout(config.dropout)

        # Mood conditioning
        if config.use_mood_conditioning:
            self.mood_emb = nn.Embedding(config.n_moods, config.d_model)
        else:
            self.mood_emb = None

        # Transformer blocks
        self.blocks = nn.ModuleList(
            [TransformerBlock(config) for _ in range(config.n_layers)]
        )
        self.ln_f = nn.LayerNorm(config.d_model)

        # Language-model head (weight-tied with tok_emb)
        self.lm_head = nn.Linear(config.d_model, config.vocab_size, bias=False)
        self.lm_head.weight = self.tok_emb.weight  # weight tying

        # Pre-compute RoPE frequencies (not a parameter, just a buffer)
        head_dim = config.d_model // config.n_heads
        freqs_cis = _precompute_freqs_cis(head_dim, config.max_seq_len * 2)
        self.register_buffer("freqs_cis", torch.view_as_real(freqs_cis), persistent=False)

        # Init weights
        self.apply(self._init_weights)
        # Scale residual projections per GPT-2 paper
        for pn, p in self.named_parameters():
            if pn.endswith("out_proj.weight") or pn.endswith("fc2.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * config.n_layers))

        print(f"MidiTransformer initialized: {self.num_parameters() / 1e6:.2f}M parameters")

    def _init_weights(self, module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
        elif isinstance(module, nn.LayerNorm):
            nn.init.ones_(module.weight)
            nn.init.zeros_(module.bias)

    def num_parameters(self, exclude_embeddings: bool = False) -> int:
        """Count total (or non-embedding) trainable parameters."""
        n = sum(p.numel() for p in self.parameters())
        if exclude_embeddings:
            n -= self.tok_emb.weight.numel()
            if self.mood_emb is not None:
                n -= self.mood_emb.weight.numel()
        return n

    def _get_freqs_cis(self) -> torch.Tensor:
        """Retrieve the RoPE frequency buffer as complex tensor."""
        return torch.view_as_complex(self.freqs_cis)

    def forward(
        self,
        input_ids: torch.Tensor,
        mood_ids: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Forward pass returning logits.

        Args:
            input_ids: Token ids, shape (B, T).
            mood_ids: Optional mood category indices, shape (B,).

        Returns:
            Logits of shape (B, T, vocab_size).
        """
        B, T = input_ids.shape
        assert T <= self.config.max_seq_len, (
            f"Sequence length {T} exceeds max_seq_len {self.config.max_seq_len}"
        )

        x = self.tok_emb(input_ids)  # (B, T, d_model)

        # Add mood embedding (broadcast over time dimension)
        if self.mood_emb is not None and mood_ids is not None:
            mood_vec = self.mood_emb(mood_ids)  # (B, d_model)
            x = x + mood_vec.unsqueeze(1)  # (B, 1, d_model) broadcast

        x = self.emb_dropout(x)

        freqs_cis = self._get_freqs_cis()
        for block in self.blocks:
            x = block(x, freqs_cis)

        x = self.ln_f(x)
        return self.lm_head(x)

    @torch.no_grad()
    def generate(
        self,
        prompt_ids: torch.Tensor,
        mood_id: Optional[int] = None,
        max_len: int = 512,
        temperature: float = 1.0,
        top_k: int = 50,
        top_p: float = 0.95,
        eos_token_id: Optional[int] = None,
    ) -> torch.Tensor:
        """Auto-regressive generation with temperature, top-k, and top-p (nucleus) sampling.

        Args:
            prompt_ids: Starting token ids, shape (1, T_prompt) or (T_prompt,).
            mood_id: Mood category index (int) or None.
            max_len: Maximum number of new tokens to generate.
            temperature: Sampling temperature (>0). Lower = more deterministic.
            top_k: Keep only top-k logits before sampling. 0 = disabled.
            top_p: Nucleus sampling threshold. 1.0 = disabled.
            eos_token_id: If provided, stop generation when this token is sampled.

        Returns:
            Generated token sequence including prompt, shape (1, T_total).
        """
        if prompt_ids.dim() == 1:
            prompt_ids = prompt_ids.unsqueeze(0)

        device = prompt_ids.device
        mood_t = (
            torch.tensor([mood_id], device=device, dtype=torch.long)
            if mood_id is not None
            else None
        )

        ids = prompt_ids
        for _ in range(max_len):
            # Crop to max_seq_len if needed
            context = ids[:, -self.config.max_seq_len:]
            logits = self.forward(context, mood_ids=mood_t)
            logits = logits[:, -1, :]  # last position

            # Temperature
            if temperature != 1.0:
                logits = logits / temperature

            # Top-k filtering
            if top_k > 0:
                topk_vals, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < topk_vals[:, -1:]] = float("-inf")

            # Top-p (nucleus) filtering
            if top_p < 1.0:
                sorted_logits, sorted_indices = torch.sort(logits, descending=True)
                cumulative_probs = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
                # Remove tokens with cumulative probability above threshold
                mask = cumulative_probs - F.softmax(sorted_logits, dim=-1) >= top_p
                sorted_logits[mask] = float("-inf")
                # Scatter back
                logits = sorted_logits.scatter(1, sorted_indices, sorted_logits)

            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)
            ids = torch.cat([ids, next_id], dim=1)

            if eos_token_id is not None and next_id.item() == eos_token_id:
                break

        return ids

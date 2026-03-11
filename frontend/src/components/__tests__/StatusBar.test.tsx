import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../StatusBar.tsx';

describe('StatusBar', () => {
  it('renders connected status', () => {
    render(<StatusBar connectionStatus="connected" />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders connecting status', () => {
    render(<StatusBar connectionStatus="connecting" />);
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('renders disconnected status', () => {
    render(<StatusBar connectionStatus="disconnected" />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('has a status role for accessibility', () => {
    render(<StatusBar connectionStatus="connected" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-live polite for screen readers', () => {
    render(<StatusBar connectionStatus="connected" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

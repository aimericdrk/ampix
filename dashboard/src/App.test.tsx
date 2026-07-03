import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('boots to the login page when no session exists', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpMix' })).toBeInTheDocument();
  });
});

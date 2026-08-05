import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  minorToPesoInput,
  parsePesosToMinor,
  peso,
  percentOff,
} from './money';

describe('parsePesosToMinor', () => {
  it('reads a whole peso amount', () => {
    expect(parsePesosToMinor('2499')).toBe(249900);
  });

  it('reads centavos', () => {
    expect(parsePesosToMinor('2499.50')).toBe(249950);
  });

  it('ignores the peso sign, commas, and spaces', () => {
    expect(parsePesosToMinor(' ₱2,499.50 ')).toBe(249950);
  });

  it('refuses more than two decimal places', () => {
    expect(parsePesosToMinor('10.123')).toBe(null);
  });

  it('refuses letters, an empty value, and a negative number', () => {
    expect(parsePesosToMinor('ten pesos')).toBe(null);
    expect(parsePesosToMinor('')).toBe(null);
    expect(parsePesosToMinor('-5')).toBe(null);
  });
});

describe('minorToPesoInput', () => {
  it('writes centavos as a decimal a number input accepts', () => {
    expect(minorToPesoInput(249900)).toBe('2499.00');
    expect(minorToPesoInput(0)).toBe('0.00');
  });

  it('survives a round trip through the parser', () => {
    expect(parsePesosToMinor(minorToPesoInput(123456))).toBe(123456);
  });
});

describe('formatMoney', () => {
  it('shows whole pesos with no decimal places', () => {
    expect(formatMoney(peso(249900))).toBe('₱2,499');
  });

  it('shows centavos when they are not zero', () => {
    expect(formatMoney(peso(249950))).toBe('₱2,499.50');
  });
});

describe('percentOff', () => {
  it('rounds the discount to a whole percent', () => {
    expect(percentOff(249900, 199900)).toBe('-20%');
  });
});

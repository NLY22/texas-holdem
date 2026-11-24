import { Card, Suit } from '../types/poker';

export const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Fisher-Yates 洗牌算法，确保发牌绝对随机公平
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function rankToLabel(rank: number): string {
  switch (rank) {
    case 14: return 'A';
    case 13: return 'K';
    case 12: return 'Q';
    case 11: return 'J';
    case 10: return '10';
    default: return rank.toString();
  }
}

export function suitToSymbol(suit: Suit): { symbol: string; isRed: boolean } {
  switch (suit) {
    case 'hearts': return { symbol: '♥', isRed: true };
    case 'diamonds': return { symbol: '♦', isRed: true };
    case 'clubs': return { symbol: '♣', isRed: false };
    case 'spades': return { symbol: '♠', isRed: false };
  }
}

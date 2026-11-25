export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export interface Card {
  suit: Suit;
  rank: number; // 2 - 14 (11=J, 12=Q, 13=K, 14=A)
}

export enum HandRank {
  HIGH_CARD = 1,
  ONE_PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10,
}

export interface HandEvaluation {
  rank: HandRank;
  name: string;
  score: number;
  bestFive: Card[];
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  currentBet: number;
  totalRoundBet: number; // 本局累计投入
  holeCards: Card[];
  folded: boolean;
  isAllIn: boolean;
  isBot: boolean;
  seatIndex: number; // 0 - 5
  showCards?: boolean;
}

export type GameStage = 'WAITING' | 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export type ActionType = 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN';

export interface GameAction {
  type: ActionType;
  amount?: number;
  playerId: string;
}

export interface WinnerInfo {
  playerId: string;
  name: string;
  amount: number;
  handName: string;
  cards: Card[];
}

export interface GameState {
  roomId: string;
  hostId: string;
  stage: GameStage;
  communityCards: Card[];
  pots: Pot[];
  totalPot: number;
  currentBet: number;
  minRaise: number;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  activePlayerIndex: number;
  pendingPlayerIds: string[]; // 本轮待行动玩家列表 (核心状态机保证)
  lastRaiserIndex: number;
  players: (Player | null)[];
  winners: WinnerInfo[];
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
}

export type P2PMessage =
  | { type: 'JOIN_REQUEST'; name: string; avatar: string; seatIndex?: number }
  | { type: 'JOIN_RESPONSE'; success: boolean; state?: GameState; error?: string }
  | { type: 'STATE_UPDATE'; state: GameState }
  | { type: 'DEAL_CARDS'; cards: Card[] }
  | { type: 'PLAYER_ACTION'; action: GameAction }
  | { type: 'CHAT_MESSAGE'; sender: string; text: string }
  | { type: 'RESTART_GAME' };

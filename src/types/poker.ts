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

export type SeatStatus = 'ACTIVE' | 'SITTING_OUT' | 'BUSTED' | 'DISCONNECTED';

export type BotPersonality = 'LOOSE' | 'TAG' | 'LAG';

export type TableTheme = 'emerald' | 'obsidian' | 'navy';

export interface RoomConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingChips: number;
  actionTimeoutSec: number; // 0 = 不限时
  autoNextHand: boolean; // false = 手动下一手, true = 5秒自动续局
  blindEscalationHands: number; // 0 = 固定盲注, >0 = 每N手翻倍
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  startingChips: 1000,
  actionTimeoutSec: 0,
  autoNextHand: false,
  blindEscalationHands: 0,
};

export interface LastActionBadge {
  label: string;
  tone: 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'sitout' | 'show';
  handNumber: number;
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
  status?: SeatStatus;
  totalBuyIn?: number;
  botPersonality?: BotPersonality;
  removeAfterHand?: boolean;
  sitOutAfterHand?: boolean;
  lastAction?: LastActionBadge;
  handsPlayed?: number;
  handsWon?: number;
  handStartChips?: number;
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
  potLabel?: string;
}

export interface LedgerEntry {
  playerId: string;
  name: string;
  isBot: boolean;
  totalBuyIn: number;
  currentChips: number;
  handsPlayed: number;
  handsWon: number;
  status: 'SEATED' | 'LEFT';
  leftAt?: number;
}

export interface HandLogEntry {
  handNumber: number;
  timestamp: number;
  winners: { name: string; amount: number; handName: string }[];
  communityCards: Card[];
  totalPot: number;
  actions: string[];
}

export interface QuickChatEvent {
  id: string;
  playerId: string;
  name: string;
  text: string;
  timestamp: number;
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
  pendingPlayerIds: string[]; // 本轮待行动玩家列表
  cannotRaiseIds?: string[]; // 短全下后本街禁止再加注的已行动玩家
  lastRaiserIndex: number;
  players: (Player | null)[];
  winners: WinnerInfo[];
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  handNumber: number;
  roundNumber?: number;
  config?: RoomConfig;
  ledger?: Record<string, LedgerEntry>;
  handHistory?: HandLogEntry[];
  currentHandActions?: string[];
  turnDeadline?: number;
  nextHandDeadline?: number;
  earlyWinCanShow?: boolean;
  rabbitCards?: Card[];
  hasRabbitHunted?: boolean;
  deadPotMoney?: number;
  actionSeq?: number;
}

export type ClientCommand =
  | { type: 'JOIN_REQUEST'; name: string; avatar: string; seatIndex?: number }
  | { type: 'PLAYER_ACTION'; action: GameAction }
  | { type: 'START_HAND' }
  | { type: 'ADD_BOT'; seatIndex?: number; personality?: BotPersonality }
  | { type: 'REMOVE_BOT'; seatIndex: number }
  | { type: 'CLEAR_BOTS' }
  | { type: 'SIT_AT_SEAT'; seatIndex: number }
  | { type: 'TOGGLE_SIT_OUT' }
  | { type: 'REBUY_REQUEST'; mode?: 'rebuy' | 'topup' }
  | { type: 'KICK_PLAYER'; seatIndex: number }
  | { type: 'TRANSFER_HOST'; targetPlayerId: string }
  | { type: 'UPDATE_CONFIG'; config: Partial<RoomConfig> }
  | { type: 'SHOW_WINNER_CARDS' }
  | { type: 'RABBIT_HUNT' }
  | { type: 'QUICK_CHAT'; text: string }
  | { type: 'RESET_TABLE' }
  | { type: 'DISSOLVE_ROOM' }
  | { type: 'PLAYER_LEAVE' };

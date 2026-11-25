import {
  BotPersonality,
  Card,
  DEFAULT_ROOM_CONFIG,
  GameAction,
  GameState,
  HandLogEntry,
  LedgerEntry,
  Player,
  RoomConfig,
  WinnerInfo,
} from '../types/poker';
import { createDeck, shuffleDeck } from './deck';
import { calculatePots, resolveWinners } from './pots';

const BOT_NAMES_BY_PERSONALITY: Record<BotPersonality, string[]> = {
  LOOSE: ['摸鱼图灵', '快乐香农', '松鱼高斯'],
  TAG: ['稳健深蓝', '冷静阿尔法', '冯诺依曼'],
  LAG: ['疯狗欧拉', '狂暴拉普拉斯', '猛男达尔文'],
};

const PERSONALITY_CYCLE: BotPersonality[] = ['TAG', 'LOOSE', 'LAG'];

export function createInitialState(
  roomId: string,
  hostId: string,
  customConfig?: Partial<RoomConfig>
): GameState {
  const config: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...customConfig };
  return {
    roomId,
    hostId,
    stage: 'WAITING',
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: config.bigBlind,
    dealerIndex: 0,
    smallBlindIndex: 1,
    bigBlindIndex: 2,
    activePlayerIndex: -1,
    pendingPlayerIds: [],
    cannotRaiseIds: [],
    lastRaiserIndex: -1,
    players: [null, null, null, null, null, null],
    winners: [],
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante: config.ante,
    handNumber: 0,
    roundNumber: 1,
    config,
    ledger: {},
    handHistory: [],
    currentHandActions: [],
    actionSeq: 0,
  };
}

export function isSeatEligibleForHand(p: Player | null): p is Player {
  if (!p) return false;
  if (p.chips <= 0) return false;
  const st = p.status || 'ACTIVE';
  return st === 'ACTIVE';
}

export function getNextPlayerIndex(
  players: (Player | null)[],
  startIndex: number,
  filter: (p: Player) => boolean
): number {
  const safeStart = startIndex < 0 ? 0 : startIndex;
  for (let i = 1; i <= players.length; i++) {
    const idx = (safeStart + i) % players.length;
    const player = players[idx];
    if (player && filter(player)) {
      return idx;
    }
  }
  return -1;
}

function getClockwisePlayerIds(
  players: (Player | null)[],
  startIndex: number,
  filter: (p: Player) => boolean
): string[] {
  const safeStart = startIndex < 0 ? 0 : startIndex;
  const result: string[] = [];
  for (let i = 1; i <= players.length; i++) {
    const idx = (safeStart + i) % players.length;
    const p = players[idx];
    if (p && filter(p)) {
      result.push(p.id);
    }
  }
  return result;
}

export function syncLedger(state: GameState): GameState {
  const starting = state.config?.startingChips ?? DEFAULT_ROOM_CONFIG.startingChips;
  const nextLedger: Record<string, LedgerEntry> = { ...(state.ledger || {}) };

  for (const p of state.players) {
    if (!p) continue;
    const prev = nextLedger[p.id];
    nextLedger[p.id] = {
      playerId: p.id,
      name: p.name,
      isBot: p.isBot,
      totalBuyIn: p.totalBuyIn ?? prev?.totalBuyIn ?? starting,
      currentChips: p.chips,
      handsPlayed: p.handsPlayed ?? prev?.handsPlayed ?? 0,
      handsWon: p.handsWon ?? prev?.handsWon ?? 0,
      status: 'SEATED',
    };
  }

  return { ...state, ledger: nextLedger };
}

function recordWinnerHandStats(
  players: (Player | null)[],
  winners: WinnerInfo[]
): (Player | null)[] {
  const winIds = new Set(winners.map(w => w.playerId));
  return players.map(p => {
    if (!p) return null;
    if (winIds.has(p.id)) {
      return { ...p, handsWon: (p.handsWon || 0) + 1 };
    }
    return p;
  });
}

function appendHandHistory(
  state: GameState,
  winners: WinnerInfo[],
  communityCards: Card[],
  totalPotValue: number,
  actions: string[]
): HandLogEntry[] {
  const entry: HandLogEntry = {
    handNumber: state.handNumber,
    timestamp: Date.now(),
    winners: winners.map(w => ({
      name: w.name,
      amount: w.amount,
      handName: w.handName,
    })),
    communityCards: [...communityCards],
    totalPot: totalPotValue,
    actions: actions.slice(-40),
  };
  const existing = state.handHistory || [];
  return [entry, ...existing].slice(0, 20);
}

/**
 * 清理上一手遗留标记（如手牌中预约移除的 AI、预约暂离的真人、归零淘汰玩家）
 */
export function applyPostHandHousekeeping(state: GameState): GameState {
  let nextLedger = { ...(state.ledger || {}) };
  const cleanedPlayers = state.players.map(p => {
    if (!p) return null;
    if (p.isBot && p.removeAfterHand) {
      nextLedger[p.id] = {
        playerId: p.id,
        name: p.name,
        isBot: true,
        totalBuyIn: p.totalBuyIn ?? state.config?.startingChips ?? 1000,
        currentChips: p.chips,
        handsPlayed: p.handsPlayed ?? 0,
        handsWon: p.handsWon ?? 0,
        status: 'LEFT',
        leftAt: Date.now(),
      };
      return null;
    }

    let nextStatus = p.status || 'ACTIVE';
    if (p.chips <= 0) {
      nextStatus = 'BUSTED';
    } else if (p.sitOutAfterHand) {
      nextStatus = 'SITTING_OUT';
    } else if (nextStatus === 'BUSTED' && p.chips > 0) {
      nextStatus = 'ACTIVE';
    }

    return {
      ...p,
      status: nextStatus,
      sitOutAfterHand: false,
      removeAfterHand: false,
      lastAction: undefined,
      handStartChips: undefined,
    };
  });

  return syncLedger({ ...state, players: cleanedPlayers, ledger: nextLedger });
}

/**
 * 启动新一局 (清理后处理、升盲检测、发手牌、收 Ante 与盲注)
 */
export function startNewHand(state: GameState): { state: GameState; deck: Card[] } {
  const preCleaned = applyPostHandHousekeeping(state);
  const cfg = preCleaned.config || DEFAULT_ROOM_CONFIG;

  const activePlayers = preCleaned.players.filter(isSeatEligibleForHand);
  if (activePlayers.length < 2) {
    return {
      state: {
        ...preCleaned,
        stage: 'WAITING',
        activePlayerIndex: -1,
        pendingPlayerIds: [],
        cannotRaiseIds: [],
        turnDeadline: undefined,
        nextHandDeadline: undefined,
      },
      deck: [],
    };
  }

  // 检测是否需要升盲
  let smallBlind = preCleaned.smallBlind || cfg.smallBlind;
  let bigBlind = preCleaned.bigBlind || cfg.bigBlind;
  let ante = preCleaned.ante ?? cfg.ante;
  if (
    cfg.blindEscalationHands > 0 &&
    preCleaned.handNumber > 0 &&
    preCleaned.handNumber % cfg.blindEscalationHands === 0
  ) {
    smallBlind *= 2;
    bigBlind *= 2;
    ante *= 2;
  }

  const deck = shuffleDeck(createDeck());

  const nextDealer = getNextPlayerIndex(preCleaned.players, preCleaned.dealerIndex, isSeatEligibleForHand);
  const nextSB =
    activePlayers.length === 2
      ? nextDealer
      : getNextPlayerIndex(preCleaned.players, nextDealer, isSeatEligibleForHand);
  const nextBB = getNextPlayerIndex(preCleaned.players, nextSB, isSeatEligibleForHand);

  let totalPot = 0;
  const handNum = preCleaned.handNumber + 1;
  const initialActions: string[] = [];

  const newPlayers: (Player | null)[] = preCleaned.players.map((p, idx) => {
    if (!p) return null;
    if (p.chips <= 0 || (p.status || 'ACTIVE') !== 'ACTIVE') {
      return {
        ...p,
        currentBet: 0,
        totalRoundBet: 0,
        holeCards: [],
        folded: true,
        isAllIn: false,
        showCards: false,
        lastAction: undefined,
      };
    }

    const handStartChips = p.chips;
    let chips = p.chips;
    let roundBet = 0;
    let streetBet = 0;
    let isAllIn = false;

    if (ante > 0 && chips > 0) {
      const paidAnte = Math.min(chips, ante);
      chips -= paidAnte;
      roundBet += paidAnte;
      totalPot += paidAnte;
      if (chips === 0) isAllIn = true;
    }

    if (idx === nextSB && chips > 0) {
      const sbPaid = Math.min(chips, smallBlind);
      chips -= sbPaid;
      streetBet += sbPaid;
      roundBet += sbPaid;
      totalPot += sbPaid;
      if (chips === 0) isAllIn = true;
      initialActions.push(`${p.name} 小盲 $${sbPaid}`);
    } else if (idx === nextBB && chips > 0) {
      const bbPaid = Math.min(chips, bigBlind);
      chips -= bbPaid;
      streetBet += bbPaid;
      roundBet += bbPaid;
      totalPot += bbPaid;
      if (chips === 0) isAllIn = true;
      initialActions.push(`${p.name} 大盲 $${bbPaid}`);
    }

    const holeCards = [deck.pop()!, deck.pop()!];

    return {
      ...p,
      chips,
      currentBet: streetBet,
      totalRoundBet: roundBet,
      holeCards,
      folded: false,
      isAllIn,
      showCards: false,
      handsPlayed: (p.handsPlayed || 0) + 1,
      handStartChips,
      lastAction: undefined,
    };
  });

  const maxStreetBet = Math.max(
    bigBlind,
    ...newPlayers.map(p => (p ? p.currentBet : 0))
  );

  const pendingPlayerIds = getClockwisePlayerIds(
    newPlayers,
    nextBB,
    p => !p.folded && !p.isAllIn
  );

  const firstActiveIndex =
    pendingPlayerIds.length > 0
      ? newPlayers.findIndex(p => p && p.id === pendingPlayerIds[0])
      : -1;

  const baseState: GameState = syncLedger({
    ...preCleaned,
    stage: 'PREFLOP',
    communityCards: [],
    pots: [
      {
        amount: totalPot,
        eligiblePlayerIds: newPlayers.filter((p): p is Player => p !== null && !p.folded).map(p => p.id),
      },
    ],
    totalPot,
    currentBet: maxStreetBet,
    minRaise: bigBlind,
    smallBlind,
    bigBlind,
    ante,
    dealerIndex: nextDealer,
    smallBlindIndex: nextSB,
    bigBlindIndex: nextBB,
    activePlayerIndex: firstActiveIndex,
    pendingPlayerIds,
    cannotRaiseIds: [],
    lastRaiserIndex: nextBB,
    players: newPlayers,
    winners: [],
    handNumber: handNum,
    currentHandActions: initialActions,
    turnDeadline: undefined,
    nextHandDeadline: undefined,
    earlyWinCanShow: false,
    rabbitCards: undefined,
    hasRabbitHunted: false,
    deadPotMoney: 0,
    actionSeq: (preCleaned.actionSeq || 0) + 1,
  });

  // 如果因为小短码在盲注阶段就全员 All-in，直接发满 5 张摊牌
  if (pendingPlayerIds.length === 0) {
    return advanceStage(baseState, deck);
  }

  return { state: baseState, deck };
}

/**
 * 推进到下一个发牌公共牌轮次 (Flop -> Turn -> River -> Showdown)
 */
export function advanceStage(state: GameState, deck: Card[]): { state: GameState; deck: Card[] } {
  const newDeck = [...deck];
  const activePlayers = state.players.filter((p): p is Player => p !== null && !p.folded);

  const resetPlayers: (Player | null)[] = state.players.map(p =>
    p ? { ...p, currentBet: 0, lastAction: undefined } : null
  );

  const nonAllInPlayers = activePlayers.filter(p => !p.isAllIn);
  const shouldRunOut = nonAllInPlayers.length <= 1;

  let nextStage = state.stage;
  const newCommunity = [...state.communityCards];

  if (state.stage === 'PREFLOP') {
    nextStage = 'FLOP';
    newDeck.pop();
    newCommunity.push(newDeck.pop()!, newDeck.pop()!, newDeck.pop()!);
  } else if (state.stage === 'FLOP') {
    nextStage = 'TURN';
    newDeck.pop();
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'TURN') {
    nextStage = 'RIVER';
    newDeck.pop();
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'RIVER') {
    nextStage = 'SHOWDOWN';
  }

  const validPlayers = resetPlayers.filter((p): p is Player => p !== null);
  const pots = calculatePots(validPlayers, state.deadPotMoney || 0);

  if (nextStage === 'SHOWDOWN' || (shouldRunOut && newCommunity.length === 5)) {
    while (newCommunity.length < 5 && newDeck.length > 0) {
      newDeck.pop();
      newCommunity.push(newDeck.pop()!);
    }

    const winners = resolveWinners(pots, validPlayers, newCommunity);
    const totalDistributed = winners.reduce((sum, w) => sum + w.amount, 0);

    let finalPlayers: (Player | null)[] = resetPlayers.map(p => {
      if (!p) return null;
      const win = winners.find(w => w.playerId === p.id);
      return {
        ...p,
        chips: p.chips + (win ? win.amount : 0),
        showCards: !p.folded,
      };
    });
    finalPlayers = recordWinnerHandStats(finalPlayers, winners);

    const handHistory = appendHandHistory(
      state,
      winners,
      newCommunity,
      totalDistributed,
      state.currentHandActions || []
    );

    const nextState = syncLedger({
      ...state,
      stage: 'SHOWDOWN',
      communityCards: newCommunity,
      pots,
      totalPot: 0,
      currentBet: 0,
      minRaise: state.bigBlind,
      activePlayerIndex: -1,
      pendingPlayerIds: [],
      cannotRaiseIds: [],
      players: finalPlayers,
      winners,
      handHistory,
      earlyWinCanShow: false,
      turnDeadline: undefined,
      actionSeq: (state.actionSeq || 0) + 1,
    });

    return { state: nextState, deck: newDeck };
  }

  const pendingPlayerIds = getClockwisePlayerIds(
    resetPlayers,
    state.dealerIndex,
    p => !p.folded && !p.isAllIn
  );

  const nextActive =
    pendingPlayerIds.length > 0
      ? resetPlayers.findIndex(p => p && p.id === pendingPlayerIds[0])
      : -1;

  if (pendingPlayerIds.length === 0) {
    return advanceStage(
      {
        ...state,
        stage: nextStage,
        communityCards: newCommunity,
        pots,
        currentBet: 0,
        minRaise: state.bigBlind,
        cannotRaiseIds: [],
        players: resetPlayers,
      },
      newDeck
    );
  }

  return {
    state: {
      ...state,
      stage: nextStage,
      communityCards: newCommunity,
      pots,
      currentBet: 0,
      minRaise: state.bigBlind,
      activePlayerIndex: nextActive,
      pendingPlayerIds,
      cannotRaiseIds: [],
      lastRaiserIndex: -1,
      players: resetPlayers,
      actionSeq: (state.actionSeq || 0) + 1,
    },
    deck: newDeck,
  };
}

/**
 * 玩家操作核心处理 (含标准短全下规则与即时全弃牌结算)
 */
export function handlePlayerAction(
  state: GameState,
  action: GameAction,
  deck: Card[]
): { state: GameState; deck: Card[] } {
  if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') {
    return { state, deck };
  }

  const playerIndex = state.players.findIndex(p => p && p.id === action.playerId);
  if (playerIndex === -1 || playerIndex !== state.activePlayerIndex) {
    return { state, deck };
  }

  const player = state.players[playerIndex]!;
  let updatedPlayer = { ...player };
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let totalPot = state.totalPot;
  let lastRaiserIndex = state.lastRaiserIndex;
  let newPendingPlayerIds = [...state.pendingPlayerIds];
  let cannotRaiseIds = [...(state.cannotRaiseIds || [])];
  const actionsLog = [...(state.currentHandActions || [])];

  // 防御：若因短全下被禁止再加注，强行将 BET/RAISE 降级为 CALL/CHECK
  let effectiveType = action.type;
  if (
    (effectiveType === 'BET' || effectiveType === 'RAISE') &&
    cannotRaiseIds.includes(player.id)
  ) {
    effectiveType = currentBet > player.currentBet ? 'CALL' : 'CHECK';
  }

  switch (effectiveType) {
    case 'FOLD':
      updatedPlayer.folded = true;
      updatedPlayer.lastAction = { label: '弃牌', tone: 'fold', handNumber: state.handNumber };
      actionsLog.push(`${player.name} 弃牌`);
      break;

    case 'CHECK':
      if (currentBet > player.currentBet) {
        // 非法 Check 保护：按 Call 处理
        const diff = currentBet - player.currentBet;
        const paid = Math.min(player.chips, diff);
        updatedPlayer.chips -= paid;
        updatedPlayer.currentBet += paid;
        updatedPlayer.totalRoundBet += paid;
        totalPot += paid;
        if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;
        updatedPlayer.lastAction = {
          label: updatedPlayer.isAllIn ? 'ALL-IN' : `跟注 $${paid}`,
          tone: updatedPlayer.isAllIn ? 'allin' : 'call',
          handNumber: state.handNumber,
        };
        actionsLog.push(`${player.name} 跟注 $${paid}`);
      } else {
        updatedPlayer.lastAction = { label: '看牌', tone: 'check', handNumber: state.handNumber };
        actionsLog.push(`${player.name} 看牌`);
      }
      break;

    case 'CALL': {
      const callDiff = Math.max(0, currentBet - player.currentBet);
      const actualCall = Math.min(player.chips, callDiff);
      updatedPlayer.chips -= actualCall;
      updatedPlayer.currentBet += actualCall;
      updatedPlayer.totalRoundBet += actualCall;
      totalPot += actualCall;
      if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;
      updatedPlayer.lastAction = {
        label: updatedPlayer.isAllIn ? 'ALL-IN' : actualCall === 0 ? '看牌' : `跟注 $${actualCall}`,
        tone: updatedPlayer.isAllIn ? 'allin' : actualCall === 0 ? 'check' : 'call',
        handNumber: state.handNumber,
      };
      actionsLog.push(`${player.name} ${actualCall === 0 ? '看牌' : `跟注 $${actualCall}`}`);
      break;
    }

    case 'BET':
    case 'RAISE': {
      const maxLegalTarget = player.chips + player.currentBet;
      const minLegalTarget = Math.min(
        maxLegalTarget,
        currentBet === 0 ? minRaise : currentBet + minRaise
      );
      const desiredTarget = action.amount ?? minLegalTarget;
      const clampedTarget = Math.max(minLegalTarget, Math.min(maxLegalTarget, Math.floor(desiredTarget)));
      const actualAdd = Math.max(0, clampedTarget - player.currentBet);

      updatedPlayer.chips -= actualAdd;
      updatedPlayer.currentBet += actualAdd;
      updatedPlayer.totalRoundBet += actualAdd;
      totalPot += actualAdd;
      if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;

      const raiseDiff = updatedPlayer.currentBet - currentBet;
      if (raiseDiff >= minRaise) {
        minRaise = raiseDiff;
        cannotRaiseIds = [];
        lastRaiserIndex = playerIndex;
        currentBet = updatedPlayer.currentBet;
        newPendingPlayerIds = getClockwisePlayerIds(
          state.players,
          playerIndex,
          p => p.id !== player.id && !p.folded && !p.isAllIn
        );
      } else if (updatedPlayer.currentBet > currentBet) {
        // 仅在全下不足 minRaise 时才会发生
        currentBet = updatedPlayer.currentBet;
        const alreadyPending = new Set(state.pendingPlayerIds);
        for (const p of state.players) {
          if (p && p.id !== player.id && !p.folded && !p.isAllIn && !alreadyPending.has(p.id)) {
            if (!cannotRaiseIds.includes(p.id)) cannotRaiseIds.push(p.id);
          }
        }
        newPendingPlayerIds = getClockwisePlayerIds(
          state.players,
          playerIndex,
          p => p.id !== player.id && !p.folded && !p.isAllIn && p.currentBet < currentBet
        );
      }

      updatedPlayer.lastAction = {
        label: updatedPlayer.isAllIn
          ? 'ALL-IN'
          : `${effectiveType === 'BET' ? '下注' : '加注'} $${updatedPlayer.currentBet}`,
        tone: updatedPlayer.isAllIn ? 'allin' : 'raise',
        handNumber: state.handNumber,
      };
      actionsLog.push(
        `${player.name} ${updatedPlayer.isAllIn ? `ALL-IN $${updatedPlayer.currentBet}` : `${effectiveType === 'BET' ? '下注' : '加注至'} $${updatedPlayer.currentBet}`}`
      );
      break;
    }

    case 'ALL_IN': {
      const allInAmount = player.chips;
      updatedPlayer.chips = 0;
      updatedPlayer.currentBet += allInAmount;
      updatedPlayer.totalRoundBet += allInAmount;
      totalPot += allInAmount;
      updatedPlayer.isAllIn = true;

      if (updatedPlayer.currentBet > currentBet) {
        const raiseDiff = updatedPlayer.currentBet - currentBet;
        currentBet = updatedPlayer.currentBet;

        if (raiseDiff >= minRaise) {
          minRaise = raiseDiff;
          lastRaiserIndex = playerIndex;
          cannotRaiseIds = [];
          newPendingPlayerIds = getClockwisePlayerIds(
            state.players,
            playerIndex,
            p => p.id !== player.id && !p.folded && !p.isAllIn
          );
        } else {
          // 短筹码全下：不足一个完整加注，不重开已行动玩家加注权
          const alreadyPending = new Set(state.pendingPlayerIds);
          for (const p of state.players) {
            if (p && p.id !== player.id && !p.folded && !p.isAllIn && !alreadyPending.has(p.id)) {
              if (!cannotRaiseIds.includes(p.id)) cannotRaiseIds.push(p.id);
            }
          }
          newPendingPlayerIds = getClockwisePlayerIds(
            state.players,
            playerIndex,
            p => p.id !== player.id && !p.folded && !p.isAllIn && p.currentBet < currentBet
          );
        }
      }
      updatedPlayer.lastAction = { label: 'ALL-IN', tone: 'allin', handNumber: state.handNumber };
      actionsLog.push(`${player.name} ALL-IN ($${updatedPlayer.currentBet})`);
      break;
    }
  }

  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = updatedPlayer;
  newPendingPlayerIds = newPendingPlayerIds.filter(id => id !== player.id);

  // 1. 只剩最后 1 名未弃牌玩家 -> 直接提前获胜（默认盖牌，提供秀一手入口）
  const nonFolded = updatedPlayers.filter((p): p is Player => p !== null && !p.folded);
  if (nonFolded.length === 1) {
    const soleWinner = nonFolded[0];
    let finalPlayers = updatedPlayers.map(p =>
      p
        ? {
            ...p,
            currentBet: 0,
            chips: p.id === soleWinner.id ? p.chips + totalPot : p.chips,
          }
        : null
    );
    const winners: WinnerInfo[] = [
      {
        playerId: soleWinner.id,
        name: soleWinner.name,
        amount: totalPot,
        handName: '对手全弃牌获胜',
        cards: soleWinner.holeCards,
        potLabel: '底池',
      },
    ];
    finalPlayers = recordWinnerHandStats(finalPlayers, winners);
    const handHistory = appendHandHistory(
      state,
      winners,
      state.communityCards,
      totalPot,
      actionsLog
    );

    return {
      state: syncLedger({
        ...state,
        stage: 'SHOWDOWN',
        totalPot: 0,
        pots: [],
        currentBet: 0,
        activePlayerIndex: -1,
        pendingPlayerIds: [],
        cannotRaiseIds: [],
        players: finalPlayers,
        winners,
        handHistory,
        currentHandActions: actionsLog,
        earlyWinCanShow: !soleWinner.isBot,
        turnDeadline: undefined,
        actionSeq: (state.actionSeq || 0) + 1,
      }),
      deck,
    };
  }

  // 2. 当前下注轮结束 -> 推进下一街
  if (newPendingPlayerIds.length === 0) {
    return advanceStage(
      {
        ...state,
        totalPot,
        currentBet,
        minRaise,
        cannotRaiseIds,
        currentHandActions: actionsLog,
        players: updatedPlayers,
      },
      deck
    );
  }

  // 3. 顺延下一位行动玩家
  const nextPlayerId = newPendingPlayerIds[0];
  const nextPlayerIndex = updatedPlayers.findIndex(p => p && p.id === nextPlayerId);

  return {
    state: syncLedger({
      ...state,
      totalPot,
      currentBet,
      minRaise,
      lastRaiserIndex,
      activePlayerIndex: nextPlayerIndex,
      pendingPlayerIds: newPendingPlayerIds,
      cannotRaiseIds,
      currentHandActions: actionsLog,
      players: updatedPlayers,
      actionSeq: (state.actionSeq || 0) + 1,
    }),
    deck,
  };
}

/**
 * 行动超时托管动作（能看牌则看牌，否则自动弃牌；若已断线则顺便标为暂离）
 */
export function applyTimeoutAction(
  state: GameState,
  deck: Card[]
): { state: GameState; deck: Card[] } {
  if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN' || state.activePlayerIndex === -1) {
    return { state, deck };
  }
  const active = state.players[state.activePlayerIndex];
  if (!active) return { state, deck };

  const canCheck = state.currentBet <= active.currentBet;
  const res = handlePlayerAction(
    state,
    { type: canCheck ? 'CHECK' : 'FOLD', playerId: active.id },
    deck
  );

  // 若该玩家原本处于 DISCONNECTED，超时后自动切入下局暂离，避免之后每局继续卡死全桌
  const playersWithSitOut = res.state.players.map(p =>
    p && p.id === active.id && p.status === 'DISCONNECTED'
      ? { ...p, sitOutAfterHand: true }
      : p
  );
  return { state: { ...res.state, players: playersWithSitOut }, deck: res.deck };
}

/**
 * 新玩家入座 (若正在打牌则以 SITTING_OUT 观战状态入座，下局自动转 ACTIVE)
 */
export function addPlayerToSeat(
  state: GameState,
  input: { id: string; name: string; avatar?: string; preferredSeat?: number }
): { state: GameState; joined: boolean; error?: string } {
  const existingIdx = state.players.findIndex(p => p && p.id === input.id);
  if (existingIdx !== -1) {
    const updated = state.players.map((p, i) =>
      i === existingIdx && p
        ? {
            ...p,
            status:
              p.status === 'DISCONNECTED'
                ? p.chips > 0
                  ? ('ACTIVE' as const)
                  : ('BUSTED' as const)
                : p.status,
          }
        : p
    );
    return { state: syncLedger({ ...state, players: updated }), joined: true };
  }

  let seatIndex = -1;
  if (
    input.preferredSeat !== undefined &&
    input.preferredSeat >= 0 &&
    input.preferredSeat < 6 &&
    state.players[input.preferredSeat] === null
  ) {
    seatIndex = input.preferredSeat;
  } else {
    seatIndex = state.players.findIndex(p => p === null);
  }

  if (seatIndex === -1) {
    return { state, joined: false, error: '房间已满 (最多6人)' };
  }

  const isMidHand = state.stage !== 'WAITING' && state.stage !== 'SHOWDOWN';
  const startingChips = state.config?.startingChips ?? DEFAULT_ROOM_CONFIG.startingChips;
  const prevLedger = state.ledger?.[input.id];

  const newPlayer: Player = {
    id: input.id,
    name: input.name,
    avatar: input.avatar || '',
    chips: startingChips,
    currentBet: 0,
    totalRoundBet: 0,
    holeCards: [],
    folded: isMidHand,
    isAllIn: false,
    isBot: false,
    seatIndex,
    status: 'ACTIVE',
    totalBuyIn: (prevLedger?.totalBuyIn || 0) + startingChips,
    handsPlayed: prevLedger?.handsPlayed || 0,
    handsWon: prevLedger?.handsWon || 0,
  };

  const nextPlayers = [...state.players];
  nextPlayers[seatIndex] = newPlayer;
  return { state: syncLedger({ ...state, players: nextPlayers }), joined: true };
}

/**
 * 自由添加 AI 电脑（支持指定座位与性格）
 */
export function addBotToSeat(
  state: GameState,
  seatIdx?: number,
  personality?: BotPersonality
): GameState {
  const targetIndex =
    seatIdx !== undefined && seatIdx >= 0 && seatIdx < 6 && state.players[seatIdx] === null
      ? seatIdx
      : state.players.findIndex(p => p === null);
  if (targetIndex === -1) return state;

  const existingBotsCount = state.players.filter(p => p && p.isBot).length;
  const chosenPersonality: BotPersonality =
    personality || PERSONALITY_CYCLE[existingBotsCount % PERSONALITY_CYCLE.length];

  const pool = BOT_NAMES_BY_PERSONALITY[chosenPersonality];
  const usedNames = new Set(state.players.filter(Boolean).map(p => p!.name));
  const pickedName =
    pool.find(n => !usedNames.has(`AI·${n}`)) ||
    `${pool[existingBotsCount % pool.length]}${targetIndex + 1}`;

  const startingChips = state.config?.startingChips ?? DEFAULT_ROOM_CONFIG.startingChips;
  const isMidHand = state.stage !== 'WAITING' && state.stage !== 'SHOWDOWN';

  const botPlayer: Player = {
    id: 'bot-' + Math.random().toString(36).slice(2, 8),
    name: `AI·${pickedName}`,
    avatar: '',
    chips: startingChips,
    currentBet: 0,
    totalRoundBet: 0,
    holeCards: [],
    folded: isMidHand,
    isAllIn: false,
    isBot: true,
    seatIndex: targetIndex,
    status: 'ACTIVE',
    totalBuyIn: startingChips,
    botPersonality: chosenPersonality,
    handsPlayed: 0,
    handsWon: 0,
  };

  const nextPlayers = [...state.players];
  nextPlayers[targetIndex] = botPlayer;
  return syncLedger({ ...state, players: nextPlayers });
}

/**
 * 自由移除 AI 电脑（等待/摊牌立即删除；手牌进行中标记本手结束自动删除，再点可取消）
 */
export function removeOrToggleBot(state: GameState, seatIndex: number): GameState {
  const target = state.players[seatIndex];
  if (!target || !target.isBot) return state;

  if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') {
    const nextLedger = { ...(state.ledger || {}) };
    nextLedger[target.id] = {
      playerId: target.id,
      name: target.name,
      isBot: true,
      totalBuyIn: target.totalBuyIn ?? state.config?.startingChips ?? 1000,
      currentChips: target.chips,
      handsPlayed: target.handsPlayed ?? 0,
      handsWon: target.handsWon ?? 0,
      status: 'LEFT',
      leftAt: Date.now(),
    };
    const nextPlayers = [...state.players];
    nextPlayers[seatIndex] = null;
    return syncLedger({ ...state, players: nextPlayers, ledger: nextLedger });
  }

  // 手牌进行中：标记或取消下局移除
  const nextPlayers = state.players.map((p, i) =>
    i === seatIndex && p ? { ...p, removeAfterHand: !p.removeAfterHand } : p
  );
  return { ...state, players: nextPlayers };
}

export function clearAllBots(state: GameState): GameState {
  let next = state;
  for (let i = 0; i < 6; i++) {
    if (next.players[i]?.isBot) {
      next = removeOrToggleBot(next, i);
    }
  }
  return next;
}

/**
 * 任意玩家自由换座（仅在等待或摊牌时、或自己处于暂离/已弃牌不破坏牌局时）
 */
export function sitPlayerAtSeat(
  state: GameState,
  playerId: string,
  targetSeatIndex: number
): GameState {
  if (targetSeatIndex < 0 || targetSeatIndex >= 6) return state;
  if (state.players[targetSeatIndex] !== null) return state;
  if (state.stage !== 'WAITING' && state.stage !== 'SHOWDOWN') return state;

  const currentIdx = state.players.findIndex(p => p && p.id === playerId);
  if (currentIdx === -1 || currentIdx === targetSeatIndex) return state;

  const nextPlayers = [...state.players];
  const moving = { ...nextPlayers[currentIdx]!, seatIndex: targetSeatIndex };
  nextPlayers[currentIdx] = null;
  nextPlayers[targetSeatIndex] = moving;
  return { ...state, players: nextPlayers };
}

/**
 * 切换暂离观战 (WAITING / SHOWDOWN 立即切换; 手牌进行中预约下局暂离)
 */
export function togglePlayerSitOut(state: GameState, playerId: string): GameState {
  const idx = state.players.findIndex(p => p && p.id === playerId);
  if (idx === -1) return state;
  const target = state.players[idx]!;

  const nextPlayers = [...state.players];
  if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') {
    const curStatus = target.status || 'ACTIVE';
    if (curStatus === 'BUSTED') return state;
    const nextStatus = curStatus === 'SITTING_OUT' ? 'ACTIVE' : 'SITTING_OUT';
    nextPlayers[idx] = {
      ...target,
      status: nextStatus,
      sitOutAfterHand: false,
      lastAction:
        nextStatus === 'SITTING_OUT'
          ? { label: '暂离观战', tone: 'sitout', handNumber: state.handNumber }
          : undefined,
    };
  } else {
    nextPlayers[idx] = {
      ...target,
      sitOutAfterHand: !target.sitOutAfterHand,
    };
  }
  return { ...state, players: nextPlayers };
}

/**
 * 补充筹码 (Rebuy) 或补满初始筹码 (Top-up)
 */
export function rebuyOrTopUpPlayer(
  state: GameState,
  playerId: string,
  mode: 'rebuy' | 'topup' = 'rebuy'
): GameState {
  const idx = state.players.findIndex(p => p && p.id === playerId);
  if (idx === -1) return state;
  const p = state.players[idx]!;
  const starting = state.config?.startingChips ?? DEFAULT_ROOM_CONFIG.startingChips;

  if (mode === 'rebuy' && p.chips <= 0) {
    const nextPlayers = [...state.players];
    nextPlayers[idx] = {
      ...p,
      chips: starting,
      totalBuyIn: (p.totalBuyIn ?? starting) + starting,
      status: 'ACTIVE',
    };
    return syncLedger({ ...state, players: nextPlayers });
  }

  if (
    mode === 'topup' &&
    (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') &&
    p.chips > 0 &&
    p.chips < starting
  ) {
    const diff = starting - p.chips;
    const nextPlayers = [...state.players];
    nextPlayers[idx] = {
      ...p,
      chips: starting,
      totalBuyIn: (p.totalBuyIn ?? starting) + diff,
      status: 'ACTIVE',
    };
    return syncLedger({ ...state, players: nextPlayers });
  }

  return state;
}

/**
 * 玩家主动离桌或被请离（若处于手牌进行中，先安全弃牌推进牌局，筹码写入账本并顺延房主）
 */
export function leaveSeat(
  state: GameState,
  playerId: string,
  deck: Card[]
): { state: GameState; deck: Card[] } {
  const idx = state.players.findIndex(p => p && p.id === playerId);
  if (idx === -1) return { state, deck };

  let curState = state;
  let curDeck = deck;

  const playerBefore = curState.players[idx]!;
  const isMidHand = curState.stage !== 'WAITING' && curState.stage !== 'SHOWDOWN';

  if (isMidHand && !playerBefore.folded) {
    if (curState.activePlayerIndex === idx) {
      const foldedRes = handlePlayerAction(
        curState,
        { type: 'FOLD', playerId },
        curDeck
      );
      curState = foldedRes.state;
      curDeck = foldedRes.deck;
    } else {
      // 非当前行动位离桌：标为弃牌，移出待行动队列并检查提前胜出或推进
      const markedPlayers = curState.players.map((p, i) =>
        i === idx && p ? { ...p, folded: true } : p
      );
      const remainingPending = curState.pendingPlayerIds.filter(id => id !== playerId);
      const nonFolded = markedPlayers.filter((p): p is Player => p !== null && !p.folded);

      if (nonFolded.length === 1) {
        const winner = nonFolded[0];
        let finalPlayers = markedPlayers.map(p =>
          p
            ? {
                ...p,
                currentBet: 0,
                chips: p.id === winner.id ? p.chips + curState.totalPot : p.chips,
              }
            : null
        );
        const winners: WinnerInfo[] = [
          {
            playerId: winner.id,
            name: winner.name,
            amount: curState.totalPot,
            handName: '对手离桌获胜',
            cards: winner.holeCards,
            potLabel: '底池',
          },
        ];
        finalPlayers = recordWinnerHandStats(finalPlayers, winners);
        curState = {
          ...curState,
          stage: 'SHOWDOWN',
          totalPot: 0,
          pots: [],
          currentBet: 0,
          activePlayerIndex: -1,
          pendingPlayerIds: [],
          cannotRaiseIds: [],
          players: finalPlayers,
          winners,
          handHistory: appendHandHistory(
            curState,
            winners,
            curState.communityCards,
            curState.totalPot,
            [...(curState.currentHandActions || []), `${playerBefore.name} 离桌弃牌`]
          ),
          earlyWinCanShow: !winner.isBot,
        };
      } else if (remainingPending.length === 0) {
        const adv = advanceStage(
          {
            ...curState,
            players: markedPlayers,
            pendingPlayerIds: [],
          },
          curDeck
        );
        curState = adv.state;
        curDeck = adv.deck;
      } else {
        curState = {
          ...curState,
          players: markedPlayers,
          pendingPlayerIds: remainingPending,
        };
      }
    }
  }

  // 结算离桌时最新筹码（包含若刚刚恰好只剩他未弃牌等情况）到账本并清空座位
  const leavingNow = curState.players[idx];
  const nextLedger = { ...(curState.ledger || {}) };
  let deadPotMoney = curState.deadPotMoney || 0;
  if (leavingNow) {
    if (curState.stage !== 'WAITING' && curState.stage !== 'SHOWDOWN') {
      deadPotMoney += leavingNow.totalRoundBet || 0;
    }
    nextLedger[leavingNow.id] = {
      playerId: leavingNow.id,
      name: leavingNow.name,
      isBot: leavingNow.isBot,
      totalBuyIn: leavingNow.totalBuyIn ?? curState.config?.startingChips ?? 1000,
      currentChips: leavingNow.chips,
      handsPlayed: leavingNow.handsPlayed ?? 0,
      handsWon: leavingNow.handsWon ?? 0,
      status: 'LEFT',
      leftAt: Date.now(),
    };
  }

  const finalPlayers = [...curState.players];
  finalPlayers[idx] = null;

  // 若离桌的是房主，顺时针自动移交给下一位在线真人玩家
  let nextHostId = curState.hostId;
  if (playerId === curState.hostId) {
    const nextHumanIdx = getNextPlayerIndex(
      finalPlayers,
      idx,
      p => !p.isBot && p.status !== 'DISCONNECTED'
    );
    if (nextHumanIdx !== -1 && finalPlayers[nextHumanIdx]) {
      nextHostId = finalPlayers[nextHumanIdx]!.id;
    } else {
      const anyHuman = finalPlayers.find(p => p && !p.isBot);
      if (anyHuman) nextHostId = anyHuman.id;
    }
  }

  return {
    state: syncLedger({
      ...curState,
      hostId: nextHostId,
      deadPotMoney,
      players: finalPlayers,
      ledger: nextLedger,
      actionSeq: (curState.actionSeq || 0) + 1,
    }),
    deck: curDeck,
  };
}

/**
 * 强行解散时退回正在进行的那一手投入（保证朋友散场算账无争议）
 */
export function dissolveRoomRollback(state: GameState): GameState {
  if (state.stage === 'WAITING' || state.stage === 'SHOWDOWN') {
    return syncLedger(state);
  }
  const restoredPlayers = state.players.map(p => {
    if (!p) return null;
    const restoredChips =
      typeof p.handStartChips === 'number' ? p.handStartChips : p.chips + p.totalRoundBet;
    return {
      ...p,
      chips: restoredChips,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      handStartChips: undefined,
    };
  });

  return syncLedger({
    ...state,
    stage: 'WAITING',
    totalPot: 0,
    pots: [],
    currentBet: 0,
    activePlayerIndex: -1,
    pendingPlayerIds: [],
    players: restoredPlayers,
  });
}

/**
 * 全员重置筹码再战一轮
 */
export function resetTableForNewRound(state: GameState): GameState {
  const cleaned = applyPostHandHousekeeping(state);
  const cfg = cleaned.config || DEFAULT_ROOM_CONFIG;
  const resetPlayers = cleaned.players.map(p => {
    if (!p) return null;
    return {
      ...p,
      chips: cfg.startingChips,
      totalBuyIn: cfg.startingChips,
      currentBet: 0,
      totalRoundBet: 0,
      holeCards: [],
      folded: false,
      isAllIn: false,
      showCards: false,
      status: p.status === 'DISCONNECTED' ? ('DISCONNECTED' as const) : ('ACTIVE' as const),
      handsPlayed: 0,
      handsWon: 0,
      lastAction: undefined,
    };
  });

  return syncLedger({
    ...cleaned,
    stage: 'WAITING',
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: cfg.bigBlind,
    smallBlind: cfg.smallBlind,
    bigBlind: cfg.bigBlind,
    ante: cfg.ante,
    activePlayerIndex: -1,
    pendingPlayerIds: [],
    cannotRaiseIds: [],
    winners: [],
    handNumber: 0,
    roundNumber: (cleaned.roundNumber || 1) + 1,
    ledger: {},
    handHistory: [],
    currentHandActions: [],
    turnDeadline: undefined,
    nextHandDeadline: undefined,
    earlyWinCanShow: false,
    rabbitCards: undefined,
    hasRabbitHunted: false,
    players: resetPlayers,
    actionSeq: (cleaned.actionSeq || 0) + 1,
  });
}

/**
 * 全弃牌赢家主动「秀一手」亮出底牌
 */
export function revealEarlyWinCards(state: GameState, playerId: string): GameState {
  if (state.stage !== 'SHOWDOWN' || !state.earlyWinCanShow) return state;
  const isWinner = state.winners.some(w => w.playerId === playerId);
  if (!isWinner) return state;

  const nextPlayers = state.players.map(p =>
    p && p.id === playerId
      ? {
          ...p,
          showCards: true,
          lastAction: { label: '秀牌!', tone: 'show' as const, handNumber: state.handNumber },
        }
      : p
  );
  return {
    ...state,
    players: nextPlayers,
    earlyWinCanShow: false,
    actionSeq: (state.actionSeq || 0) + 1,
  };
}

/**
 * Rabbit Hunt：提前结束后偷看未发出的剩余公共牌（最多补齐到 5 张）
 */
export function revealRabbitHunt(state: GameState, deck: Card[]): GameState {
  if (
    state.stage !== 'SHOWDOWN' ||
    state.hasRabbitHunted ||
    state.communityCards.length >= 5
  ) {
    return state;
  }
  const tempDeck = [...deck];
  const rabbit: Card[] = [];
  const needed = 5 - state.communityCards.length;
  for (let i = 0; i < needed && tempDeck.length > 0; i++) {
    // 跳过烧牌模拟更真实
    if (tempDeck.length > 1) tempDeck.pop();
    const card = tempDeck.pop();
    if (card) rabbit.push(card);
  }
  return {
    ...state,
    rabbitCards: rabbit,
    hasRabbitHunted: true,
    actionSeq: (state.actionSeq || 0) + 1,
  };
}

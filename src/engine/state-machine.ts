import { Card, GameAction, GameState, Player, WinnerInfo } from '../types/poker';
import { createDeck, shuffleDeck } from './deck';
import { calculatePots, resolveWinners } from './pots';

export function createInitialState(roomId: string, hostId: string): GameState {
  return {
    roomId,
    hostId,
    stage: 'WAITING',
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    dealerIndex: 0,
    smallBlindIndex: 1,
    bigBlindIndex: 2,
    activePlayerIndex: -1,
    pendingPlayerIds: [],
    lastRaiserIndex: -1,
    players: [null, null, null, null, null, null],
    winners: [],
    smallBlind: 10,
    bigBlind: 20,
    handNumber: 0,
  };
}

/**
 * 顺时针获取从 startIndex 之后的下一个有效玩家席位
 */
export function getNextPlayerIndex(
  players: (Player | null)[],
  startIndex: number,
  filter: (p: Player) => boolean
): number {
  for (let i = 1; i <= players.length; i++) {
    const idx = (startIndex + i) % players.length;
    const player = players[idx];
    if (player && filter(player)) {
      return idx;
    }
  }
  return -1;
}

/**
 * 获取从 startIndex 顺时针方向所有满足条件的玩家 ID 列表
 */
function getClockwisePlayerIds(
  players: (Player | null)[],
  startIndex: number,
  filter: (p: Player) => boolean
): string[] {
  const result: string[] = [];
  for (let i = 1; i <= players.length; i++) {
    const idx = (startIndex + i) % players.length;
    const p = players[idx];
    if (p && filter(p)) {
      result.push(p.id);
    }
  }
  return result;
}

/**
 * 启动新一局 (发手牌、投盲注)
 */
export function startNewHand(state: GameState): { state: GameState; deck: Card[] } {
  const activePlayers = state.players.filter((p): p is Player => p !== null && p.chips > 0);
  if (activePlayers.length < 2) {
    return {
      state: { ...state, stage: 'WAITING' },
      deck: []
    };
  }

  let deck = shuffleDeck(createDeck());

  // 1. 顺时针移动庄家 Button
  const nextDealer = getNextPlayerIndex(state.players, state.dealerIndex, p => p.chips > 0);
  const nextSB = activePlayers.length === 2
    ? nextDealer // 单挑 (Heads-up) 规则：庄家也是小盲注
    : getNextPlayerIndex(state.players, nextDealer, p => p.chips > 0);
  const nextBB = getNextPlayerIndex(state.players, nextSB, p => p.chips > 0);

  // 2. 初始化每位玩家状态并扣除盲注
  let totalPot = 0;
  const newPlayers = state.players.map((p, idx) => {
    if (!p || p.chips <= 0) return p;

    let bet = 0;
    let chips = p.chips;
    let isAllIn = false;

    if (idx === nextSB) {
      bet = Math.min(chips, state.smallBlind);
      chips -= bet;
      if (chips === 0) isAllIn = true;
    } else if (idx === nextBB) {
      bet = Math.min(chips, state.bigBlind);
      chips -= bet;
      if (chips === 0) isAllIn = true;
    }

    totalPot += bet;

    // 发两张私密底牌
    const holeCards = [deck.pop()!, deck.pop()!];

    return {
      ...p,
      chips,
      currentBet: bet,
      totalRoundBet: bet,
      holeCards,
      folded: false,
      isAllIn,
      showCards: false
    };
  });

  // 3. 翻牌前行动序列：从大盲注顺时针下一个 (UTG) 开始，最后到大盲注 (BB 享有 Option)
  const pendingPlayerIds = getClockwisePlayerIds(
    newPlayers,
    nextBB,
    p => !p.folded && !p.isAllIn
  );

  const firstActiveIndex = pendingPlayerIds.length > 0
    ? newPlayers.findIndex(p => p && p.id === pendingPlayerIds[0])
    : -1;

  const nextState: GameState = {
    ...state,
    stage: 'PREFLOP',
    communityCards: [],
    pots: [{
      amount: totalPot,
      eligiblePlayerIds: newPlayers.filter((p): p is Player => p !== null && !p.folded).map(p => p.id)
    }],
    totalPot,
    currentBet: state.bigBlind,
    minRaise: state.bigBlind,
    dealerIndex: nextDealer,
    smallBlindIndex: nextSB,
    bigBlindIndex: nextBB,
    activePlayerIndex: firstActiveIndex,
    pendingPlayerIds,
    lastRaiserIndex: nextBB,
    players: newPlayers,
    winners: [],
    handNumber: state.handNumber + 1
  };

  return { state: nextState, deck };
}

/**
 * 推进到下一个发牌公共牌轮次 (Flop -> Turn -> River -> Showdown)
 */
export function advanceStage(state: GameState, deck: Card[]): { state: GameState; deck: Card[] } {
  const newDeck = [...deck];
  const activePlayers = state.players.filter((p): p is Player => p !== null && !p.folded);

  // 重置各玩家当前轮下注为 0
  const resetPlayers = state.players.map(p => (p ? { ...p, currentBet: 0 } : null));

  // 检查是否所有未弃牌玩家都已经 All-in，或只剩 1 位未全下玩家
  const nonAllInPlayers = activePlayers.filter(p => !p.isAllIn);
  const shouldRunOut = nonAllInPlayers.length <= 1;

  let nextStage = state.stage;
  const newCommunity = [...state.communityCards];

  if (state.stage === 'PREFLOP') {
    nextStage = 'FLOP';
    newDeck.pop(); // 烧一张
    newCommunity.push(newDeck.pop()!, newDeck.pop()!, newDeck.pop()!);
  } else if (state.stage === 'FLOP') {
    nextStage = 'TURN';
    newDeck.pop(); // 烧一张
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'TURN') {
    nextStage = 'RIVER';
    newDeck.pop(); // 烧一张
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'RIVER') {
    nextStage = 'SHOWDOWN';
  }

  // 计算主池与边池
  const validPlayers = resetPlayers.filter((p): p is Player => p !== null);
  const pots = calculatePots(validPlayers);

  // 如果达到摊牌，或者所有未弃牌玩家都已经 All-in，直接发满 5 张牌决胜
  if (nextStage === 'SHOWDOWN' || (shouldRunOut && newCommunity.length === 5)) {
    while (newCommunity.length < 5 && newDeck.length > 0) {
      newDeck.pop();
      newCommunity.push(newDeck.pop()!);
    }

    const winners = resolveWinners(pots, validPlayers, newCommunity);

    // 将筹码奖励发放给赢家
    const finalPlayers = resetPlayers.map(p => {
      if (!p) return null;
      const win = winners.find(w => w.playerId === p.id);
      return {
        ...p,
        chips: p.chips + (win ? win.amount : 0),
        showCards: !p.folded // 亮出底牌
      };
    });

    return {
      state: {
        ...state,
        stage: 'SHOWDOWN',
        communityCards: newCommunity,
        pots,
        totalPot: 0,
        currentBet: 0,
        minRaise: state.bigBlind,
        activePlayerIndex: -1,
        pendingPlayerIds: [],
        players: finalPlayers,
        winners
      },
      deck: newDeck
    };
  }

  // 翻牌后全新行动序列：从庄家顺时针开始所有未弃牌且未全下的玩家
  const pendingPlayerIds = getClockwisePlayerIds(
    resetPlayers,
    state.dealerIndex,
    p => !p.folded && !p.isAllIn
  );

  const nextActive = pendingPlayerIds.length > 0
    ? resetPlayers.findIndex(p => p && p.id === pendingPlayerIds[0])
    : -1;

  // 如果翻牌后没有需要行动的玩家（例如都已全下），直接再次推进
  if (pendingPlayerIds.length === 0) {
    return advanceStage({
      ...state,
      stage: nextStage,
      communityCards: newCommunity,
      pots,
      currentBet: 0,
      minRaise: state.bigBlind,
      players: resetPlayers
    }, newDeck);
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
      lastRaiserIndex: -1,
      players: resetPlayers
    },
    deck: newDeck
  };
}

/**
 * 玩家操作核心处理
 */
export function handlePlayerAction(
  state: GameState,
  action: GameAction,
  deck: Card[]
): { state: GameState; deck: Card[] } {
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

  switch (action.type) {
    case 'FOLD':
      updatedPlayer.folded = true;
      break;

    case 'CHECK':
      break;

    case 'CALL': {
      const callDiff = currentBet - player.currentBet;
      const actualCall = Math.min(player.chips, callDiff);
      updatedPlayer.chips -= actualCall;
      updatedPlayer.currentBet += actualCall;
      updatedPlayer.totalRoundBet += actualCall;
      totalPot += actualCall;
      if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;
      break;
    }

    case 'BET':
    case 'RAISE': {
      const targetBet = action.amount || (currentBet + minRaise);
      const addedChips = targetBet - player.currentBet;
      const actualAdd = Math.min(player.chips, addedChips);

      updatedPlayer.chips -= actualAdd;
      updatedPlayer.currentBet += actualAdd;
      updatedPlayer.totalRoundBet += actualAdd;
      totalPot += actualAdd;

      const raiseDiff = updatedPlayer.currentBet - currentBet;
      if (raiseDiff >= minRaise) {
        minRaise = raiseDiff;
      }
      currentBet = updatedPlayer.currentBet;
      lastRaiserIndex = playerIndex;
      if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;

      // 加注产生！重置其他所有未弃牌且未全下的玩家的待行动状态！
      newPendingPlayerIds = getClockwisePlayerIds(
        state.players,
        playerIndex,
        p => p.id !== player.id && !p.folded && !p.isAllIn
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
        if (raiseDiff >= minRaise) {
          minRaise = raiseDiff;
        }
        currentBet = updatedPlayer.currentBet;
        lastRaiserIndex = playerIndex;

        // 如果全下金额超过当前最高注，重置其他人待行动
        newPendingPlayerIds = getClockwisePlayerIds(
          state.players,
          playerIndex,
          p => p.id !== player.id && !p.folded && !p.isAllIn
        );
      }
      break;
    }
  }

  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = updatedPlayer;

  // 从待行动队列中移除当前已行动玩家
  newPendingPlayerIds = newPendingPlayerIds.filter(id => id !== player.id);

  // 1. 检查是否只剩最后 1 个未弃牌玩家 (直接提前结束赢取底池)
  const nonFolded = updatedPlayers.filter((p): p is Player => p !== null && !p.folded);
  if (nonFolded.length === 1) {
    const soleWinner = nonFolded[0];
    const finalPlayers = updatedPlayers.map(p =>
      p && p.id === soleWinner.id ? { ...p, chips: p.chips + totalPot } : p
    );
    const winners: WinnerInfo[] = [{
      playerId: soleWinner.id,
      name: soleWinner.name,
      amount: totalPot,
      handName: '对手全弃牌获胜',
      cards: soleWinner.holeCards
    }];

    return {
      state: {
        ...state,
        stage: 'SHOWDOWN',
        totalPot: 0,
        activePlayerIndex: -1,
        pendingPlayerIds: [],
        players: finalPlayers,
        winners
      },
      deck
    };
  }

  // 2. 检查本轮下注是否结束：待行动队列已清空
  if (newPendingPlayerIds.length === 0) {
    return advanceStage({
      ...state,
      totalPot,
      currentBet,
      minRaise,
      players: updatedPlayers
    }, deck);
  }

  // 3. 否则顺延给待行动队列中的第一位玩家
  const nextPlayerId = newPendingPlayerIds[0];
  const nextPlayerIndex = updatedPlayers.findIndex(p => p && p.id === nextPlayerId);

  return {
    state: {
      ...state,
      totalPot,
      currentBet,
      minRaise,
      lastRaiserIndex,
      activePlayerIndex: nextPlayerIndex,
      pendingPlayerIds: newPendingPlayerIds,
      players: updatedPlayers
    },
    deck
  };
}

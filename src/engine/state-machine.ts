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
    players: [null, null, null, null, null, null],
    winners: [],
    smallBlind: 10,
    bigBlind: 20,
    turnTimeout: 20,
    handNumber: 0,
  };
}

/**
 * 寻找指定位置顺时针方向下一个有效玩家席位
 */
function getNextPlayerIndex(
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

  // 1. 移动庄家 Button
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

  // 3. 翻牌前首先行动者 (UTG 枪口位)：大盲注顺时针下一个
  const firstActiveIndex = getNextPlayerIndex(newPlayers, nextBB, p => !p.folded && !p.isAllIn);

  const nextState: GameState = {
    ...state,
    stage: 'PREFLOP',
    communityCards: [],
    pots: [{ amount: totalPot, eligiblePlayerIds: newPlayers.filter((p): p is Player => p !== null && !p.folded).map(p => p.id) }],
    totalPot,
    currentBet: state.bigBlind,
    minRaise: state.bigBlind,
    dealerIndex: nextDealer,
    smallBlindIndex: nextSB,
    bigBlindIndex: nextBB,
    activePlayerIndex: firstActiveIndex,
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

  // 重置各玩家本轮当前注为 0，累计投入保持在 totalRoundBet
  const resetPlayers = state.players.map(p => (p ? { ...p, currentBet: 0 } : null));

  // 检查是否只剩 1 人未弃牌，或者所有未弃牌玩家都已经 All-in
  const nonAllInPlayers = activePlayers.filter(p => !p.isAllIn);
  const shouldRunOut = nonAllInPlayers.length <= 1;

  let nextStage = state.stage;
  const newCommunity = [...state.communityCards];

  if (state.stage === 'PREFLOP') {
    nextStage = 'FLOP';
    newDeck.pop(); // 烧一张牌
    newCommunity.push(newDeck.pop()!, newDeck.pop()!, newDeck.pop()!);
  } else if (state.stage === 'FLOP') {
    nextStage = 'TURN';
    newDeck.pop(); // 烧一张牌
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'TURN') {
    nextStage = 'RIVER';
    newDeck.pop(); // 烧牌
    newCommunity.push(newDeck.pop()!);
  } else if (state.stage === 'RIVER') {
    nextStage = 'SHOWDOWN';
  }

  // 计算主池与边池
  const validPlayers = resetPlayers.filter((p): p is Player => p !== null);
  const pots = calculatePots(validPlayers);

  // 如果已经达到摊牌，或者所有人都 All-in 且已经发满 5 张牌
  if (nextStage === 'SHOWDOWN' || (shouldRunOut && newCommunity.length === 5)) {
    // 补齐公共牌直到 5 张
    while (newCommunity.length < 5 && newDeck.length > 0) {
      newDeck.pop();
      newCommunity.push(newDeck.pop()!);
    }

    const winners = resolveWinners(pots, validPlayers, newCommunity);

    // 将筹码分发给赢家
    const finalPlayers = resetPlayers.map(p => {
      if (!p) return null;
      const win = winners.find(w => w.playerId === p.id);
      return {
        ...p,
        chips: p.chips + (win ? win.amount : 0),
        showCards: !p.folded // 摊牌亮底牌
      };
    });

    return {
      state: {
        ...state,
        stage: 'SHOWDOWN',
        communityCards: newCommunity,
        pots,
        currentBet: 0,
        minRaise: state.bigBlind,
        activePlayerIndex: -1,
        players: finalPlayers,
        winners
      },
      deck: newDeck
    };
  }

  // 翻牌后首先行动者：小盲位后首位未弃牌且未全下的玩家
  const nextActive = getNextPlayerIndex(resetPlayers, state.dealerIndex, p => !p.folded && !p.isAllIn);

  return {
    state: {
      ...state,
      stage: nextStage,
      communityCards: newCommunity,
      pots,
      currentBet: 0,
      minRaise: state.bigBlind,
      activePlayerIndex: nextActive,
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

  switch (action.type) {
    case 'FOLD':
      updatedPlayer.folded = true;
      break;

    case 'CHECK':
      // 只能在当前注已被跟平的情况下 CHECK
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
      const targetBet = action.amount || currentBet + minRaise;
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
      if (updatedPlayer.chips === 0) updatedPlayer.isAllIn = true;
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
      }
      break;
    }
  }

  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = updatedPlayer;

  // 1. 检查是否只剩最后 1 个未弃牌玩家 (直接提前获胜)
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
        players: finalPlayers,
        winners
      },
      deck
    };
  }

  // 2. 检查本轮下注是否已全部结束
  // 结束条件：所有未弃牌玩家均已行动，且当前注已跟平 (或已 All-in)
  const canActPlayers = nonFolded.filter(p => !p.isAllIn);
  const allBetsEqual = canActPlayers.every(p => p.currentBet === currentBet);

  // 寻找下一个该行动的玩家
  const nextPlayer = getNextPlayerIndex(
    updatedPlayers,
    playerIndex,
    p => !p.folded && !p.isAllIn
  );

  // 如果下注全部平齐，或者场上只剩 0~1 位未全下的玩家，推进行动到下一阶段
  if (allBetsEqual && (nextPlayer === -1 || nextPlayer <= state.dealerIndex || canActPlayers.length <= 1)) {
    return advanceStage({
      ...state,
      totalPot,
      currentBet,
      minRaise,
      players: updatedPlayers
    }, deck);
  }

  return {
    state: {
      ...state,
      totalPot,
      currentBet,
      minRaise,
      activePlayerIndex: nextPlayer,
      players: updatedPlayers
    },
    deck
  };
}

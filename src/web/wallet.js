// The wager page's one script (003 FR-045): reads the escrow through a public RPC, so it works with no
// wallet, and sends what the person's own wallet signs and pays for. Holds no key, sends nothing for anyone.
import {
  actionsFor,
  capRefusal,
  decodeStake,
  decodeString,
  decodeUint,
  decodeUintArray,
  encodeAllowance,
  encodeApprove,
  encodeBalanceOf,
  encodeCreditOf,
  encodeLockedOnClaim,
  encodeOpen,
  encodeStakeCall,
  encodeStakesOf,
  formatUnits,
  parseUnits,
  SELECTORS,
} from './wallet-abi.js';

const SHOWN = 20; // newest wagers listed; the total is always shown (003 FR-041)
const RECEIPT_POLL_MS = 2000;
const RECEIPT_WAIT_MS = 180_000;

const data = JSON.parse(document.getElementById('wager-data').textContent);
const $ = (id) => document.getElementById(id);
let account = null;
let chain = null; // the last successful read

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const utc = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// HACK(base-sepolia-rpc): OBSERVED 2026-10-20/21 — free nodes rate-limit, as HTTP 429 or as a JSON error
// ("Request is being rate limited"). So reads try each configured node in turn, then the visitor's wallet
// if it is on this network. REVISIT: if the page moves to one dedicated RPC.
async function readAll(calls) {
  const batch = calls.map(([to, callData], id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data: callData }, 'latest'] }));
  let last;
  for (const url of data.rpcUrls) {
    try {
      return await readBatch(url, batch);
    } catch (error) {
      last = error; // the next node; one refusing says nothing about the chain
    }
  }
  if (window.ethereum && (await walletOnThisChain()))
    return Promise.all(batch.map(({ params }) => window.ethereum.request({ method: 'eth_call', params })));
  throw last;
}

async function readBatch(url, batch) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
  if (!response.ok) throw new Error(`the network answered ${response.status}`); // a 429 is HTML, not JSON
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(body.error?.message ?? 'unexpected answer from the network');
  const byId = new Map(body.map((item) => [item.id, item]));
  return batch.map(({ id }) => {
    const item = byId.get(id);
    if (!item || item.error) throw new Error(item?.error?.message ?? 'a read went missing');
    return item.result;
  });
}

// eth_chainId needs no permission, so this is safe before the visitor has connected anything.
async function walletOnThisChain() {
  try {
    return (await window.ethereum.request({ method: 'eth_chainId' })) === '0x' + data.chainId.toString(16);
  } catch {
    return false; // no usable wallet: the public nodes' error stands
  }
}

const v2 = data.version === 2; // v2 credits every exit and caps what is at stake (007-escrow-v2)

async function loadChain() {
  const terms = ['paused', 'maxStake', 'feeBps', 'settlementWindow', 'timeout', 'offerLifetime'];
  // Each read is named, so v2's extra ones never shift v1's positions.
  const named = [
    ...terms.map((name) => [name, data.escrow, SELECTORS[name]]),
    ['decimals', data.token, SELECTORS.decimals],
    ['symbol', data.token, SELECTORS.symbol],
    ...(data.claimHash ? [['ids', data.escrow, encodeStakesOf(data.claimHash)]] : []),
    ...(account ? [['balance', data.token, encodeBalanceOf(account)]] : []),
    ...(v2
      ? [
          ['minStake', data.escrow, SELECTORS.minStake],
          ['maxPerClaim', data.escrow, SELECTORS.maxPerClaim],
          ['maxTotal', data.escrow, SELECTORS.maxTotal],
          ['lockedTotal', data.escrow, SELECTORS.lockedTotal],
          ...(data.claimHash ? [['lockedOnClaim', data.escrow, encodeLockedOnClaim(data.claimHash)]] : []),
          ...(account ? [['credit', data.escrow, encodeCreditOf(account)]] : []),
        ]
      : []),
  ];
  const answers = await readAll(named.map(([, to, callData]) => [to, callData]));
  const read = Object.fromEntries(named.map(([name], i) => [name, answers[i]]));
  const n = (name) => (read[name] === undefined ? null : decodeUint(read[name]));
  const ids = read.ids ? decodeUintArray(read.ids) : [];
  const decimals = Number(n('decimals'));
  const symbol = decodeString(read.symbol);
  const newest = ids.slice(-SHOWN).reverse();
  const raw = newest.length ? await readAll(newest.map((id) => [data.escrow, encodeStakeCall('stakes', id)])) : [];
  const [paused, maxStake, feeBps, settlementWindow, timeout, offerLifetime] = terms.map(n);
  const balance = n('balance');
  const caps = v2
    ? { minStake: n('minStake'), maxStake, lockedOnClaim: n('lockedOnClaim') ?? 0n, maxPerClaim: n('maxPerClaim'), lockedTotal: n('lockedTotal'), maxTotal: n('maxTotal'), decimals, symbol }
    : null;
  return {
    paused: paused === 1n,
    maxStake,
    feeBps: Number(feeBps),
    settlementWindow: Number(settlementWindow),
    timeout: Number(timeout),
    offerLifetime: Number(offerLifetime),
    decimals,
    symbol,
    total: ids.length,
    balance,
    caps,
    credit: n('credit'),
    stakes: raw.map((hex, i) => ({ id: newest[i], ...decodeStake(hex) })),
  };
}

async function refresh() {
  try {
    chain = await loadChain();
    $('chain-error').hidden = true;
  } catch (error) {
    $('chain-error').hidden = false; // never "no offers": we could not look (003 FR-043)
    $('chain-error').textContent = `Can't read the chain right now (${error.message}). Try again in a minute.`;
    $('offer-closed').textContent = 'Offers can be made once the chain can be read.';
    $('offer').hidden = true;
    return;
  }
  renderTerms();
  renderWagers();
  renderOfferForm();
  if (account) $('balance').textContent = `${short(account)} · ${units(chain.balance)}`;
  renderWithdraw();
  if (busy) setBusy(true); // a redraw mid-action draws fresh buttons: they stay locked too
}

const units = (value) => `${formatUnits(value, chain.decimals)} ${chain.symbol}`;

// v2: what the contract owes this wallet, from every stake it has left (FR-036b). Only its owner can take it.
function renderWithdraw() {
  const owed = account && chain.credit ? chain.credit : 0n;
  $('withdraw').hidden = owed === 0n;
  $('withdraw').textContent = `Withdraw ${owed ? units(owed) : ''}`;
}

function renderTerms() {
  for (const el of document.querySelectorAll('.unit')) el.textContent = chain.symbol;
  $('max-stake').textContent = chain.caps
    ? `${units(chain.maxStake)} per side, at least ${units(chain.caps.minStake)}; ${units(chain.caps.maxPerClaim)} per claim and ${units(chain.caps.maxTotal)} in the contract, at stake at once (${units(chain.caps.lockedOnClaim)} on this claim now)`
    : units(chain.maxStake);
  $('payout-rule').textContent =
    chain.feeBps === 0
      ? 'twice the stake, no fee'
      : `twice the stake, minus a ${chain.feeBps / 100}% fee`;
  $('paused').hidden = !chain.paused;
  // The contract's own numbers, so the terms always say what the buttons will do (review 2026-10-20).
  const span = (seconds) => (seconds % 86400 === 0 ? `${seconds / 86400} days` : seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${Math.round(seconds / 60)} minutes`);
  $('hold').textContent = span(chain.settlementWindow);
  $('timeout').textContent = span(chain.timeout);
  $('offer-lifetime').textContent = `after ${span(chain.offerLifetime)}`;
}

function renderWagers() {
  const list = $('wagers');
  list.replaceChildren();
  $('wager-count').textContent =
    chain.total === 0 ? `No wagers yet on ${data.chainName}.` : `Showing ${chain.stakes.length} of ${chain.total} on ${data.chainName}, newest first.`;
  for (const stake of chain.stakes) {
    const row = document.createElement('tr');
    const makerSide = stake.makerSaysHit ? 'HIT' : 'MISS';
    const empty = stake.taker === '0x0000000000000000000000000000000000000000';
    // Every party links to its own page on the explorer, so either side can check the other (and itself).
    const cells = [
      [`#${stake.id}`, `${data.explorer}/address/${data.escrow}#readContract`],
      [`${units(stake.amount)} each, on ${data.chainName}`],
      [`${short(stake.maker)} on ${makerSide}`, `${data.explorer}/address/${stake.maker}`],
      empty ? ['—'] : [`${short(stake.taker)} on ${stake.makerSaysHit ? 'MISS' : 'HIT'}`, `${data.explorer}/address/${stake.taker}`],
      [describe(stake)],
    ];
    for (const [text, href] of cells) {
      const cell = document.createElement('td');
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.rel = 'noopener';
        link.target = '_blank';
        link.textContent = text;
        if (text.startsWith('#')) link.title = `On the contract: Read Contract → stakes(${stake.id})`;
        cell.append(link);
      } else cell.textContent = text;
      row.append(cell);
    }
    const buttons = document.createElement('td');
    for (const action of actionsFor(stake, { now: nowSeconds(), account, paused: chain.paused, settlementWindow: chain.settlementWindow, timeout: chain.timeout, caps: chain.caps })) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.live ? action.label : action.refused ? `${action.label}: ${action.refused}` : `${action.label} after ${utc(action.opensAt)}`;
      button.disabled = !action.live;
      button.addEventListener('click', () => act(action.name, stake));
      buttons.append(button);
    }
    row.append(buttons);
    list.append(row);
  }
}

// The chain's state in words; a verdict on X that is not on the chain yet is the server's line above.
// v2 credits instead of sending: the money waits in the contract until its owner withdraws it.
function describe(stake) {
  const paid = v2 ? 'credited' : 'paid out';
  const back = v2 ? 'both credited back' : 'both refunded';
  switch (stake.state) {
    case 'Open':
      return nowSeconds() >= stake.offerExpiry ? 'offer expired' : `open until ${utc(stake.offerExpiry)}`;
    case 'Matched':
      return 'matched, waiting for the verdict on the chain';
    case 'Settled':
      return `${stake.outcome.toUpperCase()} on the chain, payout hold until ${utc(stake.settledAt + chain.settlementWindow)}`;
    case 'Paid':
      return `${stake.outcome.toUpperCase()}: ${paid} to the winner`;
    case 'Voided':
      return `voided by the referee: ${back}`;
    case 'Refunded':
      return stake.outcome === 'Void' ? `VOID: ${back}` : `no verdict by the timeout: ${back}`;
    case 'Expired':
      return v2 ? 'offer expired: credited back to its maker' : 'offer expired: returned to its maker';
    default:
      return stake.state;
  }
}

function renderOfferForm() {
  const open = data.authorization && nowSeconds() < data.validUntil && !chain.paused;
  $('offer').hidden = !open;
  $('offer-closed').hidden = Boolean(open);
  // The server's line stands for not-yet-locked and not-yet-signed; once read, the chain decides the rest.
  if (!open && data.authorization)
    $('offer-closed').textContent = chain.paused ? 'New offers are paused by the referee.' : 'Wagering is closed for new offers.';
}


async function connect() {
  if (!window.ethereum) {
    status('No wallet found in this browser. Install MetaMask or Coinbase Wallet, then reload.');
    return;
  }
  const [chosen] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  useAccount(chosen);
  await ensureNetwork();
  await refresh();
}

async function ensureNetwork() {
  const want = '0x' + data.chainId.toString(16);
  if ((await window.ethereum.request({ method: 'eth_chainId' })) === want) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  } catch (error) {
    if (error.code !== 4902) throw error; // 4902: the wallet does not know this network yet
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: want, chainName: data.chainName, rpcUrls: data.rpcUrls, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [data.explorer] }],
    });
  }
}

function status(text, txHash) {
  const line = $('tx-status');
  line.replaceChildren(text);
  if (txHash) {
    const link = document.createElement('a');
    link.href = `${data.explorer}/tx/${txHash}`;
    link.rel = 'noopener';
    link.textContent = ` ${short(txHash)}`;
    line.append(link);
  }
}

// Pending until mined; the page re-reads the chain after, and shows nothing as done before it is (FR-043).
async function send(label, to, callData) {
  await ensureNetwork();
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data: callData }] });
  status(`${label}: pending…`, hash);
  const started = Date.now();
  let failures = 0;
  while (Date.now() - started < RECEIPT_WAIT_MS) {
    let receipt = null;
    try {
      // The sender's own wallet node: polling the public RPC every two seconds is what earns a 429.
      receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      failures = 0;
    } catch (error) {
      // One blip is retried; a network that keeps failing is said plainly, not shown as "pending".
      if (++failures >= 5) throw new Error(`${label} was sent, but the network can't be read (${error.message}); check it on the explorer`);
    }
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error(`${label} failed on the chain`);
      status(`${label}: done.`, hash);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
  throw new Error(`${label} is still pending; check it on the explorer`);
}

// Approve exactly what this wager needs, and only when the allowance is short.
async function ensureAllowance(amount) {
  const [allowance] = await readAll([[data.token, encodeAllowance(account, data.escrow)]]);
  const allowed = decodeUint(allowance);
  if (allowed < amount) await send(`Approve ${chain.symbol}`, data.token, encodeApprove(data.escrow, amount));
}

// One transaction at a time: every control is locked from the first click until the chain has answered,
// so a second click can never open a second offer or approve twice.
// Releasing re-enables only what the lock disabled: a button the render disabled (a cap reached, a hold not
// over) stays disabled, and one rendered while locked keeps its own state.
let busy = false;
function setBusy(on) {
  busy = on;
  for (const el of document.querySelectorAll('#wallet-panel button, #wallet-panel input, #wagers button')) {
    if (on) {
      if (!el.disabled) el.dataset.locked = '1';
      el.disabled = true;
    } else if (el.dataset.locked) {
      el.disabled = false;
      delete el.dataset.locked;
    }
  }
  $('wallet-panel').classList.toggle('busy', on);
}

async function act(name, stake) {
  setBusy(true);
  try {
    if (!account) await connect();
    if (name === 'accept') {
      await refresh(); // the caps as they are now, not as the page last drew them
      const refused = capRefusal(chain.caps, stake.amount, { opening: false });
      if (refused) throw new Error(`Can't accept: ${refused}`);
      await ensureAllowance(stake.amount);
      await send('Accept', data.escrow, encodeStakeCall('accept', stake.id));
    } else {
      const labels = { expire: 'Return expired offer', payout: 'Pay out', refund: 'Refund both' };
      await send(labels[name], data.escrow, encodeStakeCall(name, stake.id));
    }
  } catch (error) {
    status(error.message);
  }
  await refresh();
  setBusy(false);
}

async function makeOffer(event) {
  event.preventDefault();
  setBusy(true);
  try {
    if (!chain) throw new Error("the chain hasn't been read yet; try again in a moment");
    if (!account) await connect();
    const amount = parseUnits($('amount').value, chain.decimals);
    if (amount === 0n || amount > chain.maxStake) throw new Error(`the amount must be above 0 and at most ${units(chain.maxStake)}`);
    // Before the wallet signs anything, so a stake the contract would refuse never costs a fee (SC-026).
    await refresh();
    const refused = capRefusal(chain.caps, amount, { opening: true });
    if (refused) throw new Error(`Can't open: ${refused}`);
    const makerSaysHit = new FormData(event.target).get('side') === 'hit';
    await ensureAllowance(amount);
    await send('Open offer', data.escrow, encodeOpen({ claimHash: data.claimHash, deadline: data.deadline, validUntil: data.validUntil, signature: data.authorization, makerSaysHit, amount }));
    $('amount').value = ''; // done: the next offer starts empty
  } catch (error) {
    status(error.message);
  }
  await refresh();
  setBusy(false);
}

// A wallet that already let this site in says so without a popup (eth_accounts), so a reload stays connected.
function useAccount(next) {
  account = next ?? null;
  $('connect').hidden = Boolean(account);
  if (!account) $('balance').textContent = '';
}

async function rememberedAccount() {
  if (!window.ethereum) return;
  try {
    const [known] = await window.ethereum.request({ method: 'eth_accounts' });
    useAccount(known);
  } catch (error) {
    status(`Can't ask the wallet who is connected: ${error.message}`);
  }
  window.ethereum.on?.('accountsChanged', ([next]) => {
    useAccount(next);
    refresh();
  });
}

async function withdraw() {
  setBusy(true);
  try {
    await send('Withdraw', data.escrow, SELECTORS.withdraw);
  } catch (error) {
    status(error.message);
  }
  await refresh();
  setBusy(false);
}

$('connect').addEventListener('click', () => connect().catch((error) => status(error.message)));
$('withdraw').addEventListener('click', withdraw);
$('offer').addEventListener('submit', makeOffer);
$('wallet-panel').hidden = false;
rememberedAccount().then(refresh);

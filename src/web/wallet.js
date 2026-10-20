// The wager page's one script (003 FR-045): reads the escrow through a public RPC, so it works with no
// wallet, and sends what the person's own wallet signs and pays for. Holds no key, sends nothing for anyone.
import {
  actionsFor,
  decodeStake,
  decodeUint,
  decodeUintArray,
  encodeAllowance,
  encodeApprove,
  encodeBalanceOf,
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

// HACK(base-sepolia-rpc): OBSERVED 2026-10-20 — the public RPC answers 429 to a page load plus a wallet
// connect. REVISIT: drop the retries and the wallet fallback if the page moves to a dedicated RPC.
const RETRY_MS = [1000, 3000];

async function post(body) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(data.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt >= RETRY_MS.length)
      throw new Error(`the network answered ${response.status}`); // a 429 is HTML, not JSON
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS[attempt]));
  }
}

// Many reads in one request (JSON-RPC batch): a page load is two requests, not one per wager.
// With a wallet connected, a public RPC that keeps refusing is skipped: the wallet's own node reads it.
async function readAll(calls) {
  try {
    return await readAllPublic(calls);
  } catch (error) {
    if (!account || !window.ethereum) throw error;
    return Promise.all(calls.map(([to, callData]) => window.ethereum.request({ method: 'eth_call', params: [{ to, data: callData }, 'latest'] })));
  }
}

async function readAllPublic(calls) {
  const body = await post(calls.map(([to, callData], id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data: callData }, 'latest'] })));
  if (!Array.isArray(body)) throw new Error(body.error?.message ?? 'unexpected answer from the network');
  const byId = new Map(body.map((item) => [item.id, item]));
  return calls.map((_, id) => {
    const item = byId.get(id);
    if (!item || item.error) throw new Error(item?.error?.message ?? 'a read went missing');
    return item.result;
  });
}

async function loadChain() {
  const terms = ['paused', 'maxStake', 'feeBps', 'settlementWindow', 'timeout', 'offerLifetime'];
  const first = await readAll([
    ...terms.map((name) => [data.escrow, SELECTORS[name]]),
    [data.token, SELECTORS.decimals],
    ...(data.claimHash ? [[data.escrow, encodeStakesOf(data.claimHash)]] : []),
    ...(account ? [[data.token, encodeBalanceOf(account)]] : []),
  ]);
  const [paused, maxStake, feeBps, settlementWindow, timeout, offerLifetime, decimals] = first.slice(0, 7).map(decodeUint);
  const ids = data.claimHash ? decodeUintArray(first[7]) : [];
  const balance = account ? decodeUint(first.at(-1)) : null;
  const newest = ids.slice(-SHOWN).reverse();
  const raw = newest.length ? await readAll(newest.map((id) => [data.escrow, encodeStakeCall('stakes', id)])) : [];
  return {
    paused: paused === 1n,
    maxStake,
    feeBps: Number(feeBps),
    settlementWindow: Number(settlementWindow),
    timeout: Number(timeout),
    offerLifetime: Number(offerLifetime),
    decimals: Number(decimals),
    total: ids.length,
    balance,
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
  if (account) $('balance').textContent = `${short(account)} · ${formatUnits(chain.balance, chain.decimals)} VTS`;
}

function renderTerms() {
  $('max-stake').textContent = `${formatUnits(chain.maxStake, chain.decimals)} VTS`;
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
    chain.total === 0 ? 'No wagers yet.' : `Showing ${chain.stakes.length} of ${chain.total}, newest first.`;
  for (const stake of chain.stakes) {
    const row = document.createElement('tr');
    const makerSide = stake.makerSaysHit ? 'HIT' : 'MISS';
    const cells = [
      `#${stake.id}`,
      `${formatUnits(stake.amount, chain.decimals)} VTS each`,
      `${short(stake.maker)} on ${makerSide}`,
      stake.taker === '0x0000000000000000000000000000000000000000' ? '—' : `${short(stake.taker)} on ${stake.makerSaysHit ? 'MISS' : 'HIT'}`,
      describe(stake),
    ];
    for (const text of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    const buttons = document.createElement('td');
    for (const action of actionsFor(stake, { now: nowSeconds(), account, paused: chain.paused, settlementWindow: chain.settlementWindow, timeout: chain.timeout })) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.live ? action.label : `${action.label} after ${utc(action.opensAt)}`;
      button.disabled = !action.live;
      button.addEventListener('click', () => act(action.name, stake));
      buttons.append(button);
    }
    row.append(buttons);
    list.append(row);
  }
}

// The chain's state in words; a verdict on X that is not on the chain yet is the server's line above.
function describe(stake) {
  switch (stake.state) {
    case 'Open':
      return nowSeconds() >= stake.offerExpiry ? 'offer expired' : `open until ${utc(stake.offerExpiry)}`;
    case 'Matched':
      return 'matched, waiting for the verdict on the chain';
    case 'Settled':
      return `${stake.outcome.toUpperCase()} on the chain, payout hold until ${utc(stake.settledAt + chain.settlementWindow)}`;
    case 'Paid':
      return `${stake.outcome.toUpperCase()}: paid out`;
    case 'Voided':
      return 'voided by the referee: both refunded';
    case 'Refunded':
      return stake.outcome === 'Void' ? 'VOID: both refunded' : 'no verdict by the timeout: both refunded';
    case 'Expired':
      return 'offer expired: returned to its maker';
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
  [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  await ensureNetwork();
  $('connect').hidden = true;
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
      params: [{ chainId: want, chainName: data.chainName, rpcUrls: [data.rpcUrl], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [data.explorer] }],
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
  if (allowed < amount) await send('Approve VTS', data.token, encodeApprove(data.escrow, amount));
}

async function act(name, stake) {
  try {
    if (!account) await connect();
    if (name === 'accept') {
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
}

async function makeOffer(event) {
  event.preventDefault();
  try {
    if (!chain) throw new Error("the chain hasn't been read yet; try again in a moment");
    if (!account) await connect();
    const amount = parseUnits($('amount').value, chain.decimals);
    if (amount === 0n || amount > chain.maxStake) throw new Error(`the amount must be above 0 and at most ${formatUnits(chain.maxStake, chain.decimals)} VTS`);
    const makerSaysHit = new FormData(event.target).get('side') === 'hit';
    await ensureAllowance(amount);
    await send('Open offer', data.escrow, encodeOpen({ claimHash: data.claimHash, deadline: data.deadline, validUntil: data.validUntil, signature: data.authorization, makerSaysHit, amount }));
  } catch (error) {
    status(error.message);
  }
  await refresh();
}

$('connect').addEventListener('click', () => connect().catch((error) => status(error.message)));
$('offer').addEventListener('submit', makeOffer);
$('wallet-panel').hidden = false;
refresh();

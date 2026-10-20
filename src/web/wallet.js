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

async function rpc(method, params) {
  const response = await fetch(data.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const read = (to, callData) => rpc('eth_call', [{ to, data: callData }, 'latest']);

async function loadChain() {
  const [paused, maxStake, feeBps, settlementWindow, timeout, decimals] = await Promise.all(
    ['paused', 'maxStake', 'feeBps', 'settlementWindow', 'timeout'].map((name) =>
      read(data.escrow, SELECTORS[name]).then(decodeUint),
    ).concat(read(data.token, SELECTORS.decimals).then(decodeUint)),
  );
  const ids = data.claimHash ? decodeUintArray(await read(data.escrow, encodeStakesOf(data.claimHash))) : [];
  const newest = ids.slice(-SHOWN).reverse();
  const stakes = await Promise.all(
    newest.map(async (id) => ({ id, ...decodeStake(await read(data.escrow, encodeStakeCall('stakes', id))) })),
  );
  return {
    paused: paused === 1n,
    maxStake,
    feeBps: Number(feeBps),
    settlementWindow: Number(settlementWindow),
    timeout: Number(timeout),
    decimals: Number(decimals),
    total: ids.length,
    stakes,
  };
}

async function refresh() {
  try {
    chain = await loadChain();
    $('chain-error').hidden = true;
  } catch (error) {
    $('chain-error').hidden = false; // never "no offers": we could not look (003 FR-043)
    $('chain-error').textContent = `Can't read the chain right now (${error.message}). Try again in a minute.`;
    return;
  }
  renderTerms();
  renderWagers();
  renderOfferForm();
  if (account) renderBalance();
}

function renderTerms() {
  $('max-stake').textContent = `${formatUnits(chain.maxStake, chain.decimals)} VTS`;
  $('payout-rule').textContent =
    chain.feeBps === 0
      ? 'twice the stake, no fee'
      : `twice the stake, minus a ${chain.feeBps / 100}% fee`;
  $('paused').hidden = !chain.paused;
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
}

async function renderBalance() {
  const balance = decodeUint(await read(data.token, encodeBalanceOf(account)));
  $('balance').textContent = `${short(account)} · ${formatUnits(balance, chain.decimals)} VTS`;
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
  while (Date.now() - started < RECEIPT_WAIT_MS) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
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
  const allowed = decodeUint(await read(data.token, encodeAllowance(account, data.escrow)));
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

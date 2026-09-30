import type { Contract, PriceTerms } from './schema.js';

// The public statement is rendered from contract fields by this fixed template — never written by a
// model, never stored — so it cannot drift from what is judged (spec "Contract model").
export function renderStatement(contract: Contract): string {
  const by = formatDeadline(contract.deadline_at);
  if (contract.resolution_method === 'price_feed' && contract.price) {
    return renderPrice(contract.price, by);
  }
  return `${contract.criterion} — by ${by}, per ${contract.source.name}`;
}

function renderPrice(price: PriceTerms, by: string): string {
  const direction = price.comparison === 'CLOSE_ABOVE' ? 'above' : 'below';
  const when = price.window_mode === 'at_deadline' ? `on ${by}` : `on any day by ${by}`;
  return `${price.product_id} daily close (UTC) ${direction} ${formatThreshold(price)} ${when}`;
}

function formatThreshold(price: PriceTerms): string {
  const amount = price.threshold.toLocaleString('en-US', { maximumFractionDigits: 8 });
  const quote = price.product_id.split('-')[1];
  return quote === 'USD' ? `$${amount}` : `${amount} ${quote}`;
}

// End of a UTC day shows as the bare date; any other instant shows date and time in UTC.
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const endOfDay = d.getUTCHours() === 23 && d.getUTCMinutes() === 59 && d.getUTCSeconds() === 59;
  return endOfDay ? date : `${date} ${d.toISOString().slice(11, 16)} UTC`;
}

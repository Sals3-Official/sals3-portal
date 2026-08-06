/**
 * Shared disclosure and plain-language copy, written once and reused
 * everywhere the same idea recurs (Overview's money position, the Listings
 * proceeds estimate, the Finances ledger, Payouts). Every string here must
 * stay in plain, simple language a new seller can understand on first read -
 * pair any necessary term with an ordinary-words explanation instead of
 * assuming the reader already knows it.
 */

export const ESTIMATE_NOT_PROFIT_NOTE =
  'This is not profit and it is not guaranteed. It does not include your own costs, and it can change if a buyer gets a refund, a discount is applied, or a tax rule changes.';

export const ESTIMATE_VARIANCE_DISCLOSURE =
  'These numbers use the rules we know today. They can still change before the order is fully settled.';

export const PAYOUT_DESTINATION_CHANGE_WARNING =
  'Changing where your money goes needs a fresh sign-in, tells the account owner right away, and pauses your next payout for 24 hours. This keeps your money safe - it is not there to slow you down.';

export const TRACE_ID_GLOSS =
  'a number you can give to support to find this payment';

export const CONCURRENT_EDIT_CONFLICT_NOTE =
  'Someone else changed this at the same time. Nothing was saved, so you do not lose either change - please check the latest value and try again.';

export const NOT_INCLUDED_IN_PROCEEDS_NOTE =
  'The cost of your goods, packaging, ads, and your own work time are not counted here. Seller Center does not guess these costs, so this number is money coming to you, not your profit.';

export const HS_CODE_HELP =
  'You need this because you ship this kind of item across a border. It is shown now so it does not surprise you later.';

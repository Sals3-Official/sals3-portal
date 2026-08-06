/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend inventory system exists yet. Names, SKUs, and
 * counts are examples, not real Sals3 stock levels.
 */

export type StockItem = {
  sku: string;
  name: string;
  variant: string;
  location: string;
  reserved: number;
  onHand: number;
};

export const STOCK_ITEMS: StockItem[] = [
  {
    sku: 'KM-32-BRN',
    name: 'Kraft mailer 32cm',
    variant: 'Brown / 100 pcs',
    location: 'Main warehouse',
    reserved: 24,
    onHand: 310,
  },
  {
    sku: 'PM-25-WHT',
    name: 'Poly mailer 25cm',
    variant: 'White / 200 pcs',
    location: 'Main warehouse',
    reserved: 60,
    onHand: 88,
  },
  {
    sku: 'BW-500',
    name: 'Bubble wrap 500mm',
    variant: '10m roll',
    location: 'Annex',
    reserved: 12,
    onHand: 41,
  },
  {
    sku: 'TR-80-58',
    name: 'Thermal roll 80×58',
    variant: 'Box of 20',
    location: 'Main warehouse',
    reserved: 8,
    onHand: 6,
  },
  {
    sku: 'PT-48-6',
    name: 'Packing tape 48mm',
    variant: '6-pack',
    location: 'Annex',
    reserved: 30,
    onHand: 154,
  },
];

export const SELLABLE_LOW_THRESHOLD = 10;

export type AuditEntry = {
  id: string;
  text: string;
  meta: string;
};

export const INITIAL_AUDIT_TRAIL: AuditEntry[] = [
  {
    id: 'audit-1',
    text: 'A. Santos (staff) changed the amount on hand for Poly mailer 25cm: 120 → 88',
    meta: 'manual · 13:12',
  },
  {
    id: 'audit-2',
    text: 'The system set aside 4 of Bubble wrap 500mm for order A-88216',
    meta: 'order · 12:58',
  },
  {
    id: 'audit-3',
    text: 'M. Reyes changed the amount on hand for Thermal roll 80×58: 60 → 6',
    meta: 'manual · 11:40',
  },
  {
    id: 'audit-4',
    text: 'A. Santos (staff) added 3 SKUs from a barcode scan',
    meta: 'scanner · 09:31',
  },
];

export const SAFETY_RULES = [
  'A change of more than 50 units, or any change that would sell more than you have in stock, asks for a second look before it saves.',
  'You can undo any change right away, and it always stays in the record below with who made it.',
  'If someone else changes the same item while you are working, your save is blocked and explained. Nothing is silently overwritten.',
];

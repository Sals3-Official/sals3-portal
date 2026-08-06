import { z } from 'zod';

export const ORDER_FILTER_KEYS = ['ready', 'cutoff', 'failed', 'all'] as const;

export const ordersQuerySchema = z.object({
  orderFilter: z.enum(ORDER_FILTER_KEYS).catch('ready'),
});

export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

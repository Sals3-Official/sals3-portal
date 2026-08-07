import { z } from 'zod';

export const businessModelSchema = z.enum(['RETAILER', 'DROPSHIPPER']);

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your full name.')
    .max(80, 'Name must be 80 characters or fewer.'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .max(254, 'Email must be 254 characters or fewer.')
    .transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters.')
    .max(128, 'Password must be 128 characters or fewer.'),
  businessModel: businessModelSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .max(254, 'Email must be 254 characters or fewer.')
    .transform((email) => email.toLowerCase()),
  password: z.string().min(1, 'Enter your password.').max(128),
  next: z.string().optional(),
});

export const emailOnlySchema = z.object({
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .max(254, 'Email must be 254 characters or fewer.')
    .transform((email) => email.toLowerCase()),
});

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Enter the 6-digit code.'),
});

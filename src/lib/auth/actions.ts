'use server';

import { signupSchema } from './schemas';
import getAuth from './server';

export type SignupActionState = {
  status: 'idle' | 'success' | 'error';
  message: string;
  fieldErrors?: Partial<Record<keyof typeof signupSchema.shape, string>>;
};

const GENERIC_SIGNUP_SUCCESS =
  'Check your email. If the address can receive Sals3 Portal mail, verification instructions are on the way.';

export async function signupSellerAction(
  _state: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    businessModel: formData.get('businessModel'),
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;

    return {
      status: 'error',
      message: 'Fix the highlighted fields and try again.',
      fieldErrors: {
        name: flattened.name?.[0],
        email: flattened.email?.[0],
        password: flattened.password?.[0],
        businessModel: flattened.businessModel?.[0],
      },
    };
  }

  try {
    await getAuth().api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        callbackURL: '/login',
        registrationBusinessModel: parsed.data.businessModel,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- server log keeps public response generic.
    console.error('Seller signup failed after validation.', error);
  }

  return {
    status: 'success',
    message: GENERIC_SIGNUP_SUCCESS,
  };
}

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(values: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address';
  if (!values.password) errors.password = 'Password is required';
  return errors;
}

export function validateSignup(values: {
  name: string;
  email: string;
  password: string;
}): FieldErrors {
  const errors = validateLogin(values);
  if (!values.name.trim()) errors.name = 'Name is required';
  if (values.password && values.password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  }
  return errors;
}

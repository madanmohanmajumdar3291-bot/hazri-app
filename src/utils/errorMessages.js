const MESSAGE_PATTERNS = [
  [/already registered|EMAIL_ALREADY_EXISTS/i, 'This email is already registered. Please log in instead.'],
  [/invalid login credentials/i, 'Incorrect email or password. Please try again.'],
  [/user not found|no account found/i, 'No account found with this email.'],
  [/email not confirmed/i, 'Please confirm your email address before logging in.'],
  [/password should be at least/i, 'Password must be at least 8 characters, with 1 number and 1 uppercase letter.'],
  [/invalid email/i, 'Please enter a valid email address.'],
  [/network request failed|fetch failed|network error/i, 'No internet connection. Please check your network.'],
  [/rate limit|too many requests/i, 'Too many attempts. Please wait a few minutes and try again.'],
];

export function getAuthErrorMessage(error) {
  const message = typeof error === 'string' ? error : error?.message || error?.code || '';
  const match = MESSAGE_PATTERNS.find(([pattern]) => pattern.test(message));
  return match ? match[1] : 'Something went wrong. Please try again.';
}

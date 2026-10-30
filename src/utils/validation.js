export const validationRules = {
  fullName: {
    required: 'Full name is required',
    minLength: { value: 2, message: 'Full name must be at least 2 characters' },
  },
  email: {
    required: 'Email address is required',
    pattern: {
      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: 'Please enter a valid email address',
    },
  },
  phone: {
    required: 'Phone number is required',
    pattern: {
      value: /^[6-9]\d{9}$/,
      message: 'Please enter a valid 10-digit Indian phone number',
    },
  },
  companyName: {
    required: 'Company name is required',
    minLength: { value: 2, message: 'Company name must be at least 2 characters' },
  },
  companyAddress: {
    required: 'Company address is required',
    minLength: { value: 10, message: 'Address must be at least 10 characters' },
  },
  password: {
    required: 'Password is required',
    pattern: {
      value: /^(?=.*\d)(?=.*[A-Z]).{8,}$/,
      message: 'Password must be at least 8 characters, with 1 number and 1 uppercase letter',
    },
  },
};

export function confirmPasswordValidate(password) {
  return (value) => value === password || 'Passwords do not match';
}


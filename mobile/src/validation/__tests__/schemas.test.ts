/**
 * Validation schemas.
 *
 * These must agree with the server's own rules: a value the backend accepts must
 * not be rejected here, and vice versa, or users hit errors that make no sense.
 */

import {
  bookingDetailsSchema,
  loginSchema,
  paymentSchema,
  phoneSchema,
  toList,
} from '@/validation/schemas';

describe('phoneSchema', () => {
  it.each([
    '+923001234567',
    '03001234567',
    '0300 1234567',
    '+92 300 123-4567',
    '(021) 111000',
  ])('accepts %s', (value) => {
    expect(phoneSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', 'abc', '123', '+', '12345678901234567890'])(
    'rejects %s',
    (value) => {
      expect(phoneSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('loginSchema', () => {
  it('requires both fields', () => {
    expect(loginSchema.safeParse({ usr: '', pwd: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ usr: 'a@b.com', pwd: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ usr: 'a@b.com', pwd: 'x' }).success).toBe(true);
  });
});

describe('bookingDetailsSchema', () => {
  const valid = {
    first_name: 'Ali',
    last_name: 'Khan',
    phone: '03001234567',
    email: 'ali@example.com',
    reason: 'Persistent cough',
  };

  it('accepts a complete booking', () => {
    expect(bookingDetailsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a booking with only the required fields', () => {
    expect(
      bookingDetailsSchema.safeParse({
        first_name: 'Ali',
        last_name: '',
        phone: '03001234567',
        email: '',
      }).success,
    ).toBe(true);
  });

  it('rejects a name containing markup, matching the server guard', () => {
    expect(
      bookingDetailsSchema.safeParse({ ...valid, first_name: '<script>x</script>' }).success,
    ).toBe(false);
  });

  it('rejects a name containing digits', () => {
    expect(bookingDetailsSchema.safeParse({ ...valid, first_name: 'Ali123' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed email but allows an empty one', () => {
    expect(bookingDetailsSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(bookingDetailsSchema.safeParse({ ...valid, email: '' }).success).toBe(true);
  });
});

describe('paymentSchema', () => {
  const schema = paymentSchema(2000);

  it('accepts a partial payment', () => {
    expect(schema.safeParse({ amount: '500' }).success).toBe(true);
  });

  it('accepts settling the exact outstanding balance', () => {
    expect(schema.safeParse({ amount: '2000' }).success).toBe(true);
  });

  it('rejects overpayment, as the backend does', () => {
    expect(schema.safeParse({ amount: '2500' }).success).toBe(false);
  });

  it('rejects zero and negative amounts', () => {
    expect(schema.safeParse({ amount: '0' }).success).toBe(false);
    expect(schema.safeParse({ amount: '-100' }).success).toBe(false);
  });

  it('accepts a grouped amount', () => {
    expect(schema.safeParse({ amount: '1,500' }).success).toBe(true);
  });
});

describe('toList', () => {
  it('splits the comma-separated input the encounter API expects', () => {
    expect(toList('headache, fever')).toEqual(['headache', 'fever']);
  });

  it('drops empty entries and trims whitespace', () => {
    expect(toList('headache,  , fever,')).toEqual(['headache', 'fever']);
  });

  it('returns an empty list for empty input', () => {
    expect(toList('')).toEqual([]);
    expect(toList(undefined)).toEqual([]);
  });
});

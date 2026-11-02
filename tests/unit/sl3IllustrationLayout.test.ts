import { expect, it } from 'vitest';
import { emptySl3, sl3Schema, sl3IllustrationLayout } from '@/data/techpub/sl3';

it('defaults older drafts to four illustrations and accepts only supported capacities', () => {
  expect(sl3Schema.parse({}).illustrationsPerPage).toBe(4);
  expect(sl3Schema.safeParse({ illustrationsPerPage: 3 }).success).toBe(false);
  const data = emptySl3();
  expect(sl3IllustrationLayout(data)).toMatchObject({ perPage: 4, columns: 2, imageHeight: 2.5 });
  expect(sl3IllustrationLayout({ ...data, illustrationsPerPage: 2 })).toMatchObject({ perPage: 2, columns: 1, imageHeight: 3 });
  expect(sl3IllustrationLayout({ ...data, illustrationsPerPage: 1 })).toMatchObject({ perPage: 1, columns: 1, imageHeight: 4.3 });
  for (const [perPage, imageHeight] of [[8, 2], [12, 1.5], [16, 1]] as const) {
    const parsed = sl3Schema.parse({ illustrationsPerPage: perPage });
    expect(sl3IllustrationLayout(parsed)).toMatchObject({ perPage, columns: 4, imageHeight });
  }
});

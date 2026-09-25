const nf = new Intl.NumberFormat('en-GB');

export const int = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));

/** £1.2m, £340k — for totals and bars, where magnitude is the point. */
export function money(v: number | null | undefined): string {
	if (v == null) return '—';
	const a = Math.abs(v);
	if (a >= 1e9) return `£${(v / 1e9).toFixed(2)}bn`;
	if (a >= 1e6) return `£${(v / 1e6).toFixed(1)}m`;
	if (a >= 1e3) return `£${Math.round(v / 1e3)}k`;
	return `£${Math.round(v)}`;
}

export const moneyExact = (v: number | null | undefined) => (v == null ? '—' : `£${nf.format(Math.round(v))}`);

export const compact = (n: number) =>
	n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : nf.format(n);

/** "03 £10k – £50k" -> "£10k – £50k": the prefix only exists to sort. */
export const stripOrder = (s: string) => s.replace(/^\d+\s+/, '');

export function ukDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const [y, m, d] = String(iso).slice(0, 10).split('-');
	return d ? `${d}/${m}/${y}` : String(iso).slice(0, 10);
}

/** "Undetermined" and "Unknown" are the data's way of saying nothing. */
export const said = (v: unknown) =>
	v == null || v === '' || v === 'Undetermined' || v === 'Unknown' ? '' : String(v);

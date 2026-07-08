// Small text utilities usable on both server and client (no dependencies).

// Strip HTML tags and decode a few common entities, collapsing whitespace.
// Used before writing user-supplied text into Odoo Html fields (e.g.
// sale.order.note) so markup a customer types is never rendered in the backoffice.
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

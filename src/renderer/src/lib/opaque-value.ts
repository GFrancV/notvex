// Zero-width, so nobody types them, and cmdk doesn't trim them.
const ZERO_WIDTH_DIGITS = [0x200b, 0x200c, 0x200d, 0x2060].map((c) => String.fromCharCode(c))

/**
 * A cmdk item value that reveals nothing and never matches a search: the item's index written in
 * zero-width digits. cmdk writes values into the DOM as data-value, where privacy mode must not
 * leave a title or tag name, and it keys items by value, so two notes sharing a title still need
 * different ones. Pass the real text as `keywords`: cmdk matches value and keywords together, and
 * keeps keywords in memory only.
 *
 * @example
 * <CommandItem value={opaqueValue(i)} keywords={[tag.name]}>
 */
export function opaqueValue(index: number): string {
  const digits = index.toString(ZERO_WIDTH_DIGITS.length)
  return [...digits].map((d) => ZERO_WIDTH_DIGITS[Number(d)]).join('')
}

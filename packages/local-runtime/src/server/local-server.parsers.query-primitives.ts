export function setStringQuery(requestUrl: URL, key: string, setter: (value: string) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(value)
  }
}

export function setNumberQuery(requestUrl: URL, key: string, setter: (value: number) => void) {
  const value = requestUrl.searchParams.get(key)

  if (value !== null) {
    setter(Number(value))
  }
}

export function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

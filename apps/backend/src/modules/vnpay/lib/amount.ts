// VNPAY nhận số tiền nhân 100 (vnp_Amount = đồng × 100). Medusa giữ VND là số nguyên đồng.
export function toVnpAmount(vnd: number): number {
  if (!Number.isInteger(vnd)) {
    throw new Error(`VND amount must be an integer, got ${vnd}`)
  }
  return vnd * 100
}

export function fromVnpAmount(vnp: number): number {
  const vnd = vnp / 100
  if (!Number.isInteger(vnd)) {
    throw new Error(`vnp_Amount must be a multiple of 100, got ${vnp}`)
  }
  return vnd
}

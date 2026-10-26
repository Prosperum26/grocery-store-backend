// vnp_TxnRef chỉ gồm chữ và số, mỗi lần thử thanh toán phải khác nhau.
// Mã phiên Medusa có dạng "<prefix>_<ULID>", ví dụ "payses_01K8...". Prefix viết thường và ULID
// (Crockford base32) không có chữ 'U', nên chữ 'U' hoa làm dấu phân cách được mà không nhập nhằng:
//   ("payses_01ABC", 2) <-> "paysesU01ABCU2"
const SESSION_ID = /^([a-z]+)_([0-9A-HJKMNP-TV-Z]+)$/
const TXN_REF = /^([a-z]+)U([0-9A-HJKMNP-TV-Z]+)U([1-9][0-9]*)$/

export function buildTxnRef(sessionId: string, attempt: number): string {
  const match = SESSION_ID.exec(sessionId)
  if (!match || !Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Cannot build vnp_TxnRef from session "${sessionId}" attempt ${attempt}`)
  }
  return `${match[1]}U${match[2]}U${attempt}`
}

export function parseTxnRef(ref: string): { sessionId: string; attempt: number } {
  const match = TXN_REF.exec(ref)
  if (!match) {
    throw new Error(`Invalid vnp_TxnRef "${ref}"`)
  }
  return { sessionId: `${match[1]}_${match[2]}`, attempt: Number(match[3]) }
}

const TO_STRING = Object.prototype.toString

export function getDataType(data) {
  return TO_STRING.call(data).slice(8, -1) // Proxy 暂不考虑吧
}

export const isNull = x => x === null
export const isUndefined = x => x === undefined
export const isBoolean = x => x === true || x === false || getDataType(x) === 'Boolean'
export const isNumber = x => getDataType(x) === 'Number'
export const isString = x => getDataType(x) === 'String'

export const isArray = Array.isArray || (x => getDataType(x) === 'Array')
export const isFunction = x => typeof x === 'function'
export const isObject = x => getDataType(x) === 'Object'
export const isNonNullObject = x => isObject(x) && !isNull(x)
export const isArrayBuffer = x => getDataType(x) === 'ArrayBuffer'

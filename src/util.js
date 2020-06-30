import * as Type from './type'

export function promisify(func) {
  if (!Type.isFunction(func)) return func
  return (args = {}) => new Promise((resolve, reject) => {
    func(
      Object.assign(args, {
        success: resolve,
        fail: reject
      })
    )
  })
}

export function addParams(url = '', params = {}) {
  const parts = url.split('?')
  const query = Object.keys(params).map(key => `${key}=${params[key]}`).join('&')
  return query ? `${parts[0]}?${query}` : parts[0]
}

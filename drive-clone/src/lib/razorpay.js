const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-script'
const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let razorpayLoader = null

export function loadRazorpayCheckout() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout is only available in the browser'))
  }

  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }

  if (razorpayLoader) {
    return razorpayLoader
  }

  razorpayLoader = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(RAZORPAY_SCRIPT_ID)

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.Razorpay), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Unable to load Razorpay checkout')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = RAZORPAY_SCRIPT_ID
    script.src = RAZORPAY_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.Razorpay) {
        resolve(window.Razorpay)
        return
      }
      reject(new Error('Razorpay checkout is not available'))
    }
    script.onerror = () => reject(new Error('Unable to load Razorpay checkout'))
    document.body.appendChild(script)
  }).catch((error) => {
    razorpayLoader = null
    throw error
  })

  return razorpayLoader
}

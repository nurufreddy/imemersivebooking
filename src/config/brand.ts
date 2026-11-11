/**
 * RwandAir identity used by the demo.
 *
 * The logo files in /public/brand are the official assets served by rwandair.com
 * (downloaded unmodified). Colours are observed on the official website CSS or
 * sampled from the official logo; they are not taken from a certified brand manual.
 */
export const BRAND = {
  name: 'RwandAir',
  /** Official wordmark with tagline "Fly the dream of Africa" (252 × 55 PNG). */
  logo: 'brand/rwandair-logo.png',
  logoAspect: 252 / 55,
  /** Official compact symbol (400 × 301 PNG). */
  icon: 'brand/rwandair-icon.png',
  iconAspect: 400 / 301,

  /** Dominant blue sampled from the official logo — seat upholstery and identity. */
  blue: '#00529C',
  /** `--b` in the official site CSS — interaction blue. */
  blueBright: '#005DAF',
  /** Frequently used UI blue in the official site CSS. */
  blueDeep: '#00509E',
  /** `--b-soft` in the official site CSS — pale selected-seat support. */
  blueSoft: '#E8F1FA',
} as const;

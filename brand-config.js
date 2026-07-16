// Public, non-secret brand settings shared by every D'fortees page.
// Operational values such as payment accounts belong in the admin settings,
// while credentials belong in backend environment variables.
window.DFORTEES_BRAND = Object.freeze({
  name: "D'fortees Pickleball Court",
  shortName: "D'fortees",
  wordmark: "D’FORTEES",
  logo: 'logodfortees.jpg',
  tagline: 'Play bold. Book easy.',
  location: 'Montevista, Davao de Oro',
  address: 'Prk-4 National Highway, 8801 Montevista',
  supportEmail: '',
  supportPhone: '',
  mapUrl: '',
  socialUrl: '',
  productionDomain: '',
});

document.addEventListener('DOMContentLoaded', () => {
  const brand = window.DFORTEES_BRAND;
  document.querySelectorAll('[data-brand-logo]').forEach((node) => { node.setAttribute('src', brand.logo); });
  document.querySelectorAll('[data-brand-name]').forEach((node) => { node.textContent = brand.name; });
  document.querySelectorAll('[data-brand-short]').forEach((node) => { node.textContent = brand.shortName; });
  document.querySelectorAll('[data-brand-wordmark]').forEach((node) => { node.textContent = brand.wordmark; });
  document.querySelectorAll('[data-brand-tagline]').forEach((node) => { node.textContent = brand.tagline; });
  document.querySelectorAll('[data-brand-location]').forEach((node) => { node.textContent = brand.location; });
  document.querySelectorAll('[data-brand-address]').forEach((node) => { node.textContent = brand.address; });
});

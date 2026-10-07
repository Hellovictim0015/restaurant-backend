const EARTH_RADIUS_KM = 6371;
export const DEFAULT_CHARGE_PER_KM = 50;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine great-circle distance in kilometers.
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Free up to `freeKm`, then `chargePerKm` for every started km beyond that
// (ceil-based). Both are admin-configurable (restaurant_settings.freeDeliveryKm
// / deliveryChargePerKm). With freeKm = 0 this is the original "chargePerKm
// from km 0" behavior.
//
// Examples with freeKm=2, chargePerKm=10: 1km->0, 2km->0, 3km->10, 4km->20,
// 5km->30, 6km->40.
export function calculateDeliveryCharge(distanceKm, chargePerKm = DEFAULT_CHARGE_PER_KM, freeKm = 0) {
  const rate = Number(chargePerKm) > 0 ? Number(chargePerKm) : DEFAULT_CHARGE_PER_KM;
  const free = Number(freeKm) > 0 ? Number(freeKm) : 0;

  if (distanceKm <= free) return 0;
  const chargeableKm = Math.ceil(distanceKm) - Math.ceil(free);
  return Math.max(chargeableKm, free > 0 ? 0 : 1) * rate;
}

// Admin-defined distance slabs, e.g. [{upToKm: 1, charge: 10}, {upToKm: 5,
// charge: 50}, {upToKm: 15, charge: 100}]. The customer pays the charge of
// the smallest tier whose `upToKm` covers their distance; a distance beyond
// every tier is capped at the last (highest upToKm) tier's charge — it never
// goes uncharged or unbounded.
//
// Example above: 1km->10, 3km->50, 5km->50, 10km->100, 20km->100 (capped).
export function calculateTieredDeliveryCharge(distanceKm, tiers) {
  const sorted = [...tiers].sort((a, b) => Number(a.upToKm) - Number(b.upToKm));
  for (const tier of sorted) {
    if (distanceKm <= Number(tier.upToKm)) return Number(tier.charge);
  }
  return Number(sorted[sorted.length - 1].charge);
}

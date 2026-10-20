"use strict";

// Slots belong to saved, enabled devices, including devices waiting to reconnect.
// Offline devices must not silently give their reserved slot to another host.
class DeviceSlots {
  constructor() {
    this.limit = 5;
    this.reservations = new Set();
  }

  snapshot(registry) {
    const enabled = Object.entries(registry)
      .filter(([, device]) => device.enabled === true)
      .sort(([a, left], [b, right]) =>
        (Number(left.pairedAt) || 0) - (Number(right.pairedAt) || 0) ||
        a.localeCompare(b),
      )
      .map(([key]) => key);
    return {
      limit: this.limit,
      active: enabled.slice(0, this.limit),
      paused: enabled.slice(this.limit),
      reserved: this.reservations.size,
      used: Math.min(enabled.length, this.limit) + this.reservations.size,
    };
  }

  reserve(registry, token) {
    if (this.reservations.has(token)) return;
    this.assertCanEnable(registry, null);
    this.reservations.add(token);
  }

  release(token) {
    this.reservations.delete(token);
  }

  assertCanEnable(registry, deviceId, reservation) {
    const others = Object.entries(registry).filter(
      ([key, device]) => key !== deviceId && device.enabled === true,
    );
    // Reconnecting an admitted device is idempotent, even during legacy overflow.
    if (this.snapshot(registry).active.includes(deviceId)) return;
    const reserved = this.reservations.size - (this.reservations.has(reservation) ? 1 : 0);
    if (others.length + reserved >= this.limit) {
      const error = Error("Five device slots are in use; disable or unpair a device first");
      error.code = "DEVICE_LIMIT_REACHED";
      error.details = { occupiedDevices: this.snapshot(registry).active };
      throw error;
    }
  }
}

module.exports = { DeviceSlots };


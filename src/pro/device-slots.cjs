"use strict";

// Slots belong to saved, enabled devices, including devices waiting to reconnect.
// Offline devices must not silently give their reserved slot to another host.
class DeviceSlots {
  constructor() {
    this.limit = 5;
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
    };
  }

  assertCanEnable(registry, deviceId) {
    const others = Object.entries(registry).filter(
      ([key, device]) => key !== deviceId && device.enabled === true,
    );
    // Reconnecting an admitted device is idempotent, even during legacy overflow.
    if (this.snapshot(registry).active.includes(deviceId)) return;
    if (others.length >= this.limit) {
      const error = Error("Five device slots are in use; disable or unpair a device first");
      error.code = "DEVICE_SLOT_LIMIT";
      throw error;
    }
  }
}

module.exports = { DeviceSlots };

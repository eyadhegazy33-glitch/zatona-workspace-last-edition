export async function waitForPrintAssets(root: HTMLElement): Promise<void> {
  const unavailableQr = root.querySelector(
    ".customer-card-qr [role='alert']",
  );
  if (unavailableQr) {
    throw new Error("A print QR code could not be generated.");
  }

  if (root.querySelector(".customer-card-qr [role='status']")) {
    let timeoutId: number | undefined;
    let observer: MutationObserver | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          const qrObserver = new MutationObserver(() => {
            if (root.querySelector(".customer-card-qr [role='alert']")) {
              qrObserver.disconnect();
              reject(new Error("A print QR code could not be generated."));
            } else if (!root.querySelector(".customer-card-qr [role='status']")) {
              qrObserver.disconnect();
              resolve();
            }
          });
          observer = qrObserver;
          qrObserver.observe(root, { childList: true, subtree: true });
        }),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("Timed out while generating print QR codes.")),
            15000,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      observer?.disconnect();
    }
  }

  const images = Array.from(root.querySelectorAll("img"));
  let timeoutId: number | undefined;
  try {
    await Promise.race([
      Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener(
                "error",
                () => reject(new Error("A print image could not be loaded.")),
                { once: true },
              );
            });
          }
          if (image.naturalWidth === 0) {
            throw new Error("A print image could not be decoded.");
          }
          await image.decode();
        }),
      ),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Timed out while loading print images.")),
          15000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
  await document.fonts.ready;
}

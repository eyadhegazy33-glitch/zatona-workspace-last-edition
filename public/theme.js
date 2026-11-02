try {
  if (localStorage.getItem("elzatona-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {
  // The app still starts with the light theme when storage is unavailable.
}

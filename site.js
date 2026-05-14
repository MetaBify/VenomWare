const keyInput = document.querySelector("#user-key");
const copyKeyedButton = document.querySelector("#copy-keyed-loader");
const loaderPreview = document.querySelector("#loader-preview");

function endpointUrl(key) {
  const url = new URL("/api/script", window.location.origin);

  if (key) {
    url.searchParams.set("null", key);
  }

  return url.toString();
}

function verifyUrl() {
  return new URL("/api/verify", window.location.origin).toString();
}

function luaString(value) {
  return JSON.stringify(String(value || ""));
}

function loaderFor(key) {
  return `getgenv().key=${luaString(key)};getgenv().venom_auth_verify_url=${luaString(verifyUrl())};loadstring(game:HttpGet(${luaString(endpointUrl(key))}))()`;
}

function updatePreview() {
  const key = keyInput.value.trim();
  loaderPreview.value = loaderFor(key || "YOUR_KEY");
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied";

  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

copyKeyedButton.addEventListener("click", () => {
  copyText(loaderFor(keyInput.value.trim() || "YOUR_KEY"), copyKeyedButton);
});

keyInput.addEventListener("input", updatePreview);
updatePreview();

// The film's play button, and the latest version on the download page.
for (const frame of document.querySelectorAll("[data-film]")) {
  const video = frame.querySelector("video");
  frame.querySelector("button").addEventListener("click", () => {
    frame.classList.add("is-playing");
    video.play();
  });
}

const version = document.querySelector("[data-version]");
if (version) {
  fetch("https://api.github.com/repos/jeelnadaa/distil/releases/latest")
    .then((r) => (r.ok ? r.json() : null))
    .then((release) => {
      if (!release) return;
      version.textContent = `${release.tag_name} · Windows 10 and 11, 64-bit`;
      const zip = release.assets?.find((a) => a.name === "Distil-win-x64.zip");
      const size = document.querySelector("[data-size]");
      if (zip && size) size.textContent = `${Math.round(zip.size / 1e6)} MB zip`;
    })
    .catch(() => {});
}

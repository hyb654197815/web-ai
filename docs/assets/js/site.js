const sectionLinks = Array.from(document.querySelectorAll(".section-tabs a[href^='#']"));
const sectionMap = new Map(
  sectionLinks
    .map((link) => {
      const target = document.querySelector(link.getAttribute("href"));
      return target ? [target, link] : null;
    })
    .filter(Boolean)
);

function activateLink(link) {
  sectionLinks.forEach((item) => item.classList.remove("is-active"));
  if (link) link.classList.add("is-active");
}

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (visible) {
      activateLink(sectionMap.get(visible.target));
    }
  },
  {
    rootMargin: "-18% 0px -60% 0px",
    threshold: [0.2, 0.4, 0.65],
  }
);

sectionMap.forEach((_, section) => observer.observe(section));
activateLink(sectionLinks[0]);

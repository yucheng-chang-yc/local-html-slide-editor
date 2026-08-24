(() => {
  const slides = [...document.querySelectorAll('.slide')];
  let index = 0;
  const counter = document.querySelector('#counter');
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
    counter.textContent = `${index + 1} / ${slides.length}`;
    document.documentElement.dataset.navigationExecuted = 'true';
  };
  document.querySelector('#prev').addEventListener('click', () => show(index - 1));
  document.querySelector('#next').addEventListener('click', () => show(index + 1));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(index - 1);
    if (event.key === 'ArrowRight') show(index + 1);
  });
  show(0);
})();

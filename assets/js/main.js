/* ============== PHENOMENAL — interactions ============== */
(function () {
  "use strict";

  const PRICE = 39;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const money = (n) => "$" + n.toFixed(2);

  /* ---- Year ---- */
  $("#year").textContent = new Date().getFullYear();

  /* ---- Nav scroll state ---- */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Mobile menu ---- */
  const burger = $("#burger");
  const navLinks = $("#navLinks");
  burger.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    burger.setAttribute("aria-expanded", open);
  });
  $$("#navLinks a").forEach((a) =>
    a.addEventListener("click", () => {
      navLinks.classList.remove("open");
      burger.setAttribute("aria-expanded", false);
    })
  );

  /* ---- Reveal on scroll ---- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---- Hero background (use generated image if present) ---- */
  const heroBg = $("#heroBg");
  const heroProbe = new Image();
  heroProbe.onload = () => {
    heroBg.style.backgroundImage =
      "radial-gradient(1200px 600px at 75% 30%,rgba(216,147,43,.18),transparent 60%), url('assets/img/hero.jpg')";
    heroBg.classList.add("has-img");
  };
  heroProbe.src = "assets/img/hero.jpg";

  /* ---- Gallery ---- */
  const galleryImages = [
    { src: "assets/img/product-main.jpg", svg: "assets/img/shirt-mockup.svg", alt: "Front view" },
    { src: "assets/img/product-2.jpg", svg: "assets/img/shirt-mockup.svg", alt: "Detail view" },
    { src: "assets/img/lifestyle.jpg", svg: "assets/img/whiskey-label.svg", alt: "Worn view" },
  ];
  const mainImg = $("#mainImg");
  const thumbs = $("#thumbs");
  const swapImg = (img, item) => {
    img.classList.remove("is-svg");
    img.onerror = () => {
      img.onerror = null;
      img.classList.add("is-svg");
      img.src = item.svg;
    };
    img.src = item.src;
    img.alt = "SHOT OF WHISKY tee — " + item.alt;
  };
  galleryImages.forEach((item, i) => {
    const b = document.createElement("button");
    if (i === 0) b.classList.add("is-active");
    const t = document.createElement("img");
    t.classList.add("is-svg-thumb");
    t.onerror = () => {
      t.onerror = null;
      t.src = item.svg;
    };
    t.src = item.src;
    t.alt = item.alt;
    b.appendChild(t);
    b.addEventListener("click", () => {
      $$(".gallery__thumbs button").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      swapImg(mainImg, item);
    });
    thumbs.appendChild(b);
  });

  /* ---- Options: color & size ---- */
  let color = "Vintage White";
  let size = "M";
  $$("#swatches .swatch").forEach((s) =>
    s.addEventListener("click", () => {
      $$("#swatches .swatch").forEach((x) => x.classList.remove("is-active"));
      s.classList.add("is-active");
      color = s.dataset.color;
      $("#colorName").textContent = color;
    })
  );
  $$("#sizes .size").forEach((s) =>
    s.addEventListener("click", () => {
      $$("#sizes .size").forEach((x) => x.classList.remove("is-active"));
      s.classList.add("is-active");
      size = s.dataset.size;
      $("#sizeName").textContent = size;
    })
  );

  /* ---- Quantity ---- */
  const qtyInput = $("#qty");
  const clampQty = () => {
    let v = parseInt(qtyInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 99) v = 99;
    qtyInput.value = v;
    return v;
  };
  $("#qtyMinus").addEventListener("click", () => {
    qtyInput.value = Math.max(1, clampQty() - 1);
  });
  $("#qtyPlus").addEventListener("click", () => {
    qtyInput.value = Math.min(99, clampQty() + 1);
  });
  qtyInput.addEventListener("change", clampQty);

  /* ---- Toast ---- */
  let toastTimer;
  const toast = $("#toast");
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  };

  /* ---- Cart ---- */
  const STORAGE = "phenomenal_cart";
  let cart = [];
  try {
    cart = JSON.parse(localStorage.getItem(STORAGE)) || [];
  } catch (_) {
    cart = [];
  }

  const cartCount = $("#cartCount");
  const cartItemsEl = $("#cartItems");
  const cartTotalEl = $("#cartTotal");

  const saveCart = () => localStorage.setItem(STORAGE, JSON.stringify(cart));

  const renderCart = () => {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    cartCount.textContent = totalQty;
    cartCount.classList.toggle("show", totalQty > 0);

    if (!cart.length) {
      cartItemsEl.innerHTML = '<p class="drawer__empty">Your cart is empty — go be phenomenal.</p>';
      cartTotalEl.textContent = money(0);
      return;
    }

    cartItemsEl.innerHTML = "";
    cart.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "cart-item";
      const img = document.createElement("img");
      img.className = "cart-item__img";
      img.alt = "Shot of Whisky tee";
      img.onerror = () => {
        img.onerror = null;
        img.src = "assets/img/shirt-mockup.svg";
        img.style.objectFit = "contain";
      };
      img.src = "assets/img/product-main.jpg";
      row.appendChild(img);

      const info = document.createElement("div");
      info.className = "cart-item__info";
      info.innerHTML =
        '<h4>Shot of Whisky Tee</h4>' +
        '<div class="cart-item__meta">' + item.color + " · " + item.size + "</div>" +
        '<div class="cart-item__bottom">' +
        '<div class="cart-item__qty">' +
        '<button data-act="dec" data-i="' + idx + '">−</button>' +
        "<span>" + item.qty + "</span>" +
        '<button data-act="inc" data-i="' + idx + '">+</button>' +
        "</div>" +
        '<span class="cart-item__price">' + money(item.qty * PRICE) + "</span>" +
        "</div>" +
        '<button class="cart-item__remove" data-act="rm" data-i="' + idx + '">Remove</button>';
      row.appendChild(info);
      cartItemsEl.appendChild(row);
    });

    const total = cart.reduce((s, i) => s + i.qty * PRICE, 0);
    cartTotalEl.textContent = money(total);
  };

  cartItemsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const i = +btn.dataset.i;
    const act = btn.dataset.act;
    if (act === "inc") cart[i].qty = Math.min(99, cart[i].qty + 1);
    if (act === "dec") cart[i].qty = Math.max(1, cart[i].qty - 1);
    if (act === "rm") cart.splice(i, 1);
    saveCart();
    renderCart();
  });

  const addToCart = () => {
    const qty = clampQty();
    const existing = cart.find((i) => i.size === size && i.color === color);
    if (existing) existing.qty = Math.min(99, existing.qty + qty);
    else cart.push({ size, color, qty });
    saveCart();
    renderCart();
    showToast("Added " + qty + " × " + size + " to cart ✓");
    openDrawer();
  };
  $("#addToCart").addEventListener("click", addToCart);

  /* ---- Drawer ---- */
  const drawer = $("#drawer");
  const backdrop = $("#backdrop");
  const openDrawer = () => {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };
  const closeDrawer = () => {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  $("#cartBtn").addEventListener("click", openDrawer);
  $("#cartClose").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  $("#checkout").addEventListener("click", () => {
    if (!cart.length) {
      showToast("Your cart is empty");
      return;
    }
    showToast("Redirecting to secure checkout… 🥃");
  });

  $("#searchBtn").addEventListener("click", () =>
    showToast("Search coming soon — only one phenomenal tee for now 😉")
  );

  /* ---- Size guide modal ---- */
  const sizeModal = $("#sizeModal");
  $("#sizeGuideBtn").addEventListener("click", () => sizeModal.classList.add("open"));
  $("#sizeClose").addEventListener("click", () => sizeModal.classList.remove("open"));
  sizeModal.addEventListener("click", (e) => {
    if (e.target === sizeModal) sizeModal.classList.remove("open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      sizeModal.classList.remove("open");
    }
  });

  /* ---- Newsletter ---- */
  $("#newsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#newsNote").textContent = "🥃 You're in! Check your inbox for 10% off.";
    e.target.reset();
  });

  /* ---- Init ---- */
  renderCart();
})();

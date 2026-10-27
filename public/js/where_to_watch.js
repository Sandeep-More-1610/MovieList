// Where to Stream: adds a "Stream: Netflix · Prime Video" line to every
// .movie-container card on the page. Works on any page with the site's movie
// cards (Tonight's Pick, and Watch Later if this script is included there).
(function () {
    const MAX_NAMES = 3;
    const CONCURRENCY = 4;

    // styles live here so the script works on pages that don't load tonights_pick.css
    if (!document.getElementById("stream-line-style")) {
        const style = document.createElement("style");
        style.id = "stream-line-style";
        style.textContent = `
            .stream-line{ color:#d2ff00; font-size:0.85rem; width:220px; height:1.3em;
                          text-align:center; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
            .stream-line.stream-dim{ color:#d2ff0077; }
            .stream-line a{ color:inherit; text-decoration:none; }
            .stream-line a:hover{ text-decoration:underline; }
            .stream-credit{ color:#d2ff0077; font-size:0.8rem; text-align:center; padding:0 0 30px; }
        `;
        document.head.appendChild(style);
    }

    function cardInfo(card) {
        const nameInput = card.querySelector('input[name="name"]');
        const posterInput = card.querySelector('input[name="poster"]');
        return {
            id: card.dataset.tmdbId || "",
            name: card.dataset.name || (nameInput ? nameInput.value : ""),
            poster: card.dataset.poster || (posterInput ? posterInput.value : ""),
        };
    }

    function lineFor(card) {
        let line = card.querySelector(".stream-line");
        if (!line) {
            line = document.createElement("p");
            line.className = "stream-line";
            line.textContent = "Checking streams...";
            const title = card.querySelector("h3");
            if (title) title.after(line); else card.appendChild(line);
        }
        return line;
    }

    function render(line, res) {
        line.textContent = "";
        line.classList.remove("stream-dim");
        if (!res || res.status !== "done") {
            line.textContent = "Streams unavailable";
            line.classList.add("stream-dim");
            return;
        }
        if (res.kind === "none" || !res.providers.length) {
            line.textContent = "Not streaming in " + res.region;
            line.classList.add("stream-dim");
            return;
        }
        const names = res.providers.map(p => p.name);
        let text = (res.kind === "stream" ? "Stream: " : "Rent/Buy: ") + names.slice(0, MAX_NAMES).join(" · ");
        if (names.length > MAX_NAMES) text += " +" + (names.length - MAX_NAMES);
        line.title = names.join(", ");

        if (res.link) {
            const a = document.createElement("a");
            a.href = res.link;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = text;
            line.appendChild(a);
        } else {
            line.textContent = text;
        }
    }

    async function load(card) {
        const info = cardInfo(card);
        const line = lineFor(card);
        if (!info.id && !info.name) { line.remove(); return; }
        const params = new URLSearchParams(info.id ? { id: info.id } : { name: info.name, poster: info.poster });
        try {
            const response = await fetch("/api/where_to_watch?" + params.toString());
            render(line, await response.json());
        } catch (err) {
            console.error(err);
            render(line, null);
        }
    }

    function start() {
        const cards = Array.from(document.querySelectorAll(".movie-container"));
        if (!cards.length) return;
        cards.forEach(lineFor);

        // TMDB requires JustWatch attribution for provider data
        if (!document.querySelector(".stream-credit")) {
            const credit = document.createElement("p");
            credit.className = "stream-credit";
            credit.textContent = "Streaming data by JustWatch via TMDB";
            const grid = cards[0].closest(".grid-class");
            if (grid) grid.after(credit); else document.body.appendChild(credit);
        }

        let i = 0;
        const worker = async () => { while (i < cards.length) await load(cards[i++]); };
        for (let w = 0; w < CONCURRENCY; w++) worker();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();

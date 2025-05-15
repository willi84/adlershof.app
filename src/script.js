const all_items = document.querySelectorAll("[data-item]");



const search = ()  => {
    const area_items = document.querySelector(".items");
    const area_no_result = document.getElementById("no-result");
    const search = document.getElementById("search");
    const searchValue = search.value.toLowerCase();
    const items = document.querySelectorAll("[data-item]");
    items.forEach(store => {
        const name = store.getAttribute('data-name').toLowerCase();
        if(name.includes(searchValue)){
            store.classList.remove("hidden");
            // store.style.display = "block";
        } else {
            store.classList.add("hidden");
            // store.style.display = "none";
        }
    });
    const foundItems = document.querySelectorAll("[data-item]:not(.hidden)");
    const search_value = document.querySelectorAll(".search__value");
    if(foundItems.length === 0){
        area_no_result.classList.remove("hidden");
        area_items.classList.add("hidden");
        search_value[0].innerText = `${searchValue}`;
    } else {
        area_no_result.classList.add("hidden");
        area_items.classList.remove("hidden");
    }
    document.getElementById("all_matches").innerText = `${foundItems.length} von `;
};
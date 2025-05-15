const fs = require("fs");
const path = require("path");
module.exports = function (eleventyConfig) {



    // Set input and output directories
// Copy static files
// eleventyConfig.addPassthroughCopy({ src: 'src/assets/', dist: 'assets' });
eleventyConfig.addPassthroughCopy("src/script.js");
eleventyConfig.addPassthroughCopy("src/styles.css");
eleventyConfig.addPassthroughCopy("src/assets/bootstrap.bundle.min.js");
eleventyConfig.addPassthroughCopy("src/assets/bootstrap.min.css");
eleventyConfig.addPassthroughCopy("src/icons"); // If you have icons
eleventyConfig.addPassthroughCopy("src/manifest.json"); // PWA support
eleventyConfig.addFilter("typeOf", value => typeof value);
eleventyConfig.addFilter("parseDate", (dateString) => {
  if(dateString === undefined) return "Invalid   Date";
  const matches = dateString.match(/\d+/g);
  if (!matches) return "Invalid Date";

  const [year, month, day] = matches.map(Number);
  const date = new Date(year, month, day);

  // German date
  return date.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
});
eleventyConfig.addFilter("maps", function(value) {
  const str = value.toString();
  // 52123445 => 52.123445
  return str.indexOf('.') !== -1 ? str :  str.slice(0, 2) + "." + str.slice(2);
});

eleventyConfig.addFilter("svg", function(filePath) {
  const fullPath = path.join(__dirname, filePath); // Ensure correct file path
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, "utf8");
  } else {
    console.warn(`⚠️ Warning: SVG file not found at ${fullPath}`);
    return `<!-- SVG not found: ${filePath} -->`;
  }
});


    return {
      dir: {
        input: "src",
        output: "_site"
      }
    };
  };
  
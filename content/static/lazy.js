document.addEventListener("DOMContentLoaded", function () {
    var lazyloadImages;

    if ("IntersectionObserver" in window) {
        lazyloadImages = document.querySelectorAll(".lazy");
        var imageObserver = new IntersectionObserver(function (entries, observer) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var image = entry.target;
                    image.src = image.dataset.src;
                    image.classList.remove("lazy");
                    imageObserver.unobserve(image);
                    resizeImage(image);
                }
            });
        });

        lazyloadImages.forEach(function (image) {
            imageObserver.observe(image);
        });
    } else {
        var lazyloadThrottleTimeout;
        lazyloadImages = document.querySelectorAll(".lazy");

        function lazyload() {
            if (lazyloadThrottleTimeout) {
                clearTimeout(lazyloadThrottleTimeout);
            }

            lazyloadThrottleTimeout = setTimeout(function () {
                var scrollTop = window.pageYOffset;
                lazyloadImages.forEach(function (img) {
                    if (img.offsetTop < (window.innerHeight + scrollTop)) {
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                    }
                });
                if (lazyloadImages.length == 0) {
                    document.removeEventListener("scroll", lazyload);
                    window.removeEventListener("resize", lazyload);
                    window.removeEventListener("orientationChange", lazyload);
                }
            }, 20);
        }

        document.addEventListener("scroll", lazyload);
        window.addEventListener("resize", lazyload);
        window.addEventListener("orientationChange", lazyload);
    }
});

document.addEventListener("DOMContentLoaded", function () {
    // add event to all images to resize upon load
    var images = document.getElementsByClassName("photography-image");
    for (var i = 0; i < images.length; i++) {
        var image = images[i];
        image.addEventListener("load", function (i) {
            console.log("Image loaded.");
            resizeImage(i.target);
        });
    }

    var resizeImages = function () {
        for (var i = 0; i < images.length; i++) {
            var image = images[i];
            resizeImage(image);
        }
    }

    window.addEventListener("resize", resizeImages);

    resizeImages();
});

function resizeImage(image) {
    if (image.naturalWidth > image.naturalHeight) {
        image.width = Math.min(image.parentElement.clientWidth - 100, 900);
        // image.width = Math.min(window.innerWidth - 100, 900);
    } else {
        image.width = Math.min(image.parentElement.clientWidth - 100, 500);
        // image.width = Math.min(window.innerWidth - 200, 600);
    }
}

document.addEventListener("DOMContentLoaded", function () {
    // un-set the src for all image so they don't load immediately.
    var images = document.getElementsByClassName("photography-image");
    for (var i = 0; i < images.length; i++) {
        var image = images[i];
        image.dataset.src = image.src;
        image.src = "";
    }
});
// Wedding Shot List Configuration
// To add a new shot: add an entry to the relevant location's shots array
// To add a new location: add a new object to the LOCATIONS array
//
// Each shot has:
//   id:          unique identifier (location-number)
//   description: what the shot is
//   notes:       optional tips for the photographer/videographer (lighting, angle, etc.)
//   type:        "photo", "video", or "both"
//   photo:       filename of reference image inside that location's photo folder
//   priority:    "must-have", "nice-to-have"
//   group:       (optional) group name — shots with the same group are clustered together

const LOCATIONS = [
  {
    id: "airbnb",
    name: "Airbnb",
    icon: "🏠",
    description: "Getting ready — indoor prep & couple shots",
    folder: "photos/airbnb",
    shots: [
      { id: "airbnb-1", description: "", notes: "", type: "photo", photo: "IMG_8358.PNG", priority: "must-have" },
      { id: "airbnb-2", description: "", notes: "", type: "photo", photo: "IMG_9646.WEBP", priority: "must-have" },
      { id: "airbnb-3", description: "", notes: "", type: "photo", photo: "IMG_9647.WEBP", priority: "must-have" },
      { id: "airbnb-4", description: "", notes: "", type: "photo", photo: "IMG_9661.WEBP", priority: "must-have" },
      { id: "airbnb-5", description: "", notes: "", type: "photo", photo: "IMG_9674.WEBP", priority: "must-have" },
      { id: "airbnb-6", description: "", notes: "", type: "photo", photo: "IMG_9675.WEBP", priority: "must-have" },
      { id: "airbnb-7", description: "", notes: "", type: "photo", photo: "IMG_9679.WEBP", priority: "must-have" },
      { id: "airbnb-8", description: "", notes: "", type: "photo", photo: "IMG_9681.WEBP", priority: "must-have" },
      { id: "airbnb-9", description: "", notes: "", type: "photo", photo: "IMG_9682.WEBP", priority: "must-have" },
      { id: "airbnb-10", description: "", notes: "", type: "photo", photo: "IMG_9683.WEBP", priority: "must-have" },
      { id: "airbnb-11", description: "", notes: "", type: "photo", photo: "IMG_9685.WEBP", priority: "must-have" }
    ]
  },
  {
    id: "botanic-gardens",
    name: "Botanic Gardens",
    icon: "🌿",
    description: "Bridal party portraits",
    folder: "photos/botanic-gardens",
    shots: [
      { id: "bg-1", description: "", notes: "", type: "photo", photo: "IMG_9638 2.WEBP", priority: "must-have" },
      { id: "bg-2", description: "", notes: "", type: "photo", photo: "IMG_9639 2.WEBP", priority: "must-have" },
      { id: "bg-3", description: "", notes: "", type: "photo", photo: "IMG_9641 2.WEBP", priority: "must-have" },
      { id: "bg-4", description: "", notes: "", type: "photo", photo: "IMG_9642 2.WEBP", priority: "must-have" },
      { id: "bg-5", description: "", notes: "", type: "photo", photo: "IMG_9643 2.WEBP", priority: "must-have" },
      { id: "bg-6", description: "", notes: "", type: "photo", photo: "IMG_9644 2.WEBP", priority: "must-have" },
      { id: "bg-7", description: "", notes: "", type: "photo", photo: "IMG_9645 2.WEBP", priority: "must-have" },
      { id: "bg-8", description: "", notes: "", type: "photo", photo: "IMG_9648 2.WEBP", priority: "must-have" },
      { id: "bg-9", description: "", notes: "", type: "photo", photo: "IMG_9649 2.WEBP", priority: "must-have" },
      { id: "bg-10", description: "", notes: "", type: "photo", photo: "IMG_9652 2.WEBP", priority: "must-have" },
      { id: "bg-11", description: "", notes: "", type: "photo", photo: "IMG_9653 2.WEBP", priority: "must-have" },
      { id: "bg-12", description: "", notes: "", type: "photo", photo: "IMG_9654 2.WEBP", priority: "must-have" },
      { id: "bg-13", description: "", notes: "", type: "photo", photo: "IMG_9655 2.WEBP", priority: "must-have" },
      { id: "bg-14", description: "", notes: "", type: "photo", photo: "IMG_9656 2.WEBP", priority: "must-have" },
      { id: "bg-15", description: "", notes: "", type: "photo", photo: "IMG_9657 2.WEBP", priority: "must-have" },
      { id: "bg-16", description: "", notes: "", type: "photo", photo: "IMG_9658 2.WEBP", priority: "must-have" },
      { id: "bg-17", description: "", notes: "", type: "photo", photo: "IMG_9666 2.WEBP", priority: "must-have" },
      { id: "bg-18", description: "", notes: "", type: "photo", photo: "IMG_9667 2.WEBP", priority: "must-have" },
      { id: "bg-19", description: "", notes: "", type: "photo", photo: "IMG_9668 2.WEBP", priority: "must-have" },
      { id: "bg-20", description: "", notes: "", type: "photo", photo: "IMG_9669 2.WEBP", priority: "must-have" },
      { id: "bg-21", description: "", notes: "", type: "photo", photo: "IMG_9671 2.WEBP", priority: "must-have" },
      { id: "bg-22", description: "", notes: "", type: "photo", photo: "IMG_9672 2.WEBP", priority: "must-have" },
      { id: "bg-23", description: "", notes: "", type: "photo", photo: "IMG_9673 2.WEBP", priority: "must-have" },
      { id: "bg-24", description: "", notes: "", type: "photo", photo: "IMG_9677 2.WEBP", priority: "must-have" },
      { id: "bg-25", description: "", notes: "", type: "photo", photo: "IMG_9678 2.WEBP", priority: "must-have" },
      { id: "bg-26", description: "", notes: "", type: "photo", photo: "IMG_9679 2.WEBP", priority: "must-have" },
      { id: "bg-27", description: "", notes: "", type: "photo", photo: "IMG_9680 2.WEBP", priority: "must-have" },
      { id: "bg-28", description: "", notes: "", type: "photo", photo: "IMG_9681 2.WEBP", priority: "must-have" },
      { id: "bg-29", description: "", notes: "", type: "photo", photo: "IMG_9684 2.WEBP", priority: "must-have" },
      { id: "bg-30", description: "", notes: "", type: "photo", photo: "IMG_9685 2.WEBP", priority: "must-have" }
    ]
  },
  {
    id: "wedding-venue",
    name: "Wedding Venue",
    icon: "💒",
    description: "Ceremony & reception shots",
    folder: "photos/wedding-venue",
    shots: [
      { id: "wv-1", description: "", notes: "", type: "photo", photo: "IMG_8358.PNG", priority: "must-have" },
      { id: "wv-2", description: "", notes: "", type: "photo", photo: "IMG_9650.WEBP", priority: "must-have" },
      { id: "wv-3", description: "", notes: "", type: "photo", photo: "IMG_9651.WEBP", priority: "must-have" },
      { id: "wv-4", description: "", notes: "", type: "photo", photo: "IMG_9674.WEBP", priority: "must-have" },
      { id: "wv-5", description: "", notes: "", type: "photo", photo: "IMG_9675.WEBP", priority: "must-have" },
      { id: "wv-6", description: "", notes: "", type: "photo", photo: "IMG_9676.WEBP", priority: "must-have" }
    ]
  },
  {
    id: "mosque",
    name: "Mosque",
    icon: "🕌",
    description: "Friday — Nikah / Traditional Islamic ceremony",
    folder: "photos/mosque",
    shots: [
      { id: "mosque-1", description: "", notes: "", type: "photo", photo: "IMG_9640.WEBP", priority: "must-have" },
      { id: "mosque-2", description: "", notes: "", type: "photo", photo: "IMG_9660.WEBP", priority: "must-have" },
      { id: "mosque-3", description: "", notes: "", type: "photo", photo: "IMG_9662.WEBP", priority: "must-have" },
      { id: "mosque-4", description: "", notes: "", type: "photo", photo: "IMG_9663.WEBP", priority: "must-have" },
      { id: "mosque-5", description: "", notes: "", type: "photo", photo: "IMG_9664.WEBP", priority: "must-have" }
    ]
  },
  {
    id: "brides-home",
    name: "Bride's Home",
    icon: "🏡",
    description: "Friday — Traditional wedding at bride's family home",
    folder: "photos/brides-home",
    shots: []
  }
];

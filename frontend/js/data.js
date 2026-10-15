const FOOD_ITEMS = [
      {
        id: 'food_1',
        name: 'Classic Burger',
        category: 'Burgers',
        desc: 'Juicy patty, fresh crisp veggies, melted cheddar & signature smoky sauce.',
        price: 149,
        badge: 'Bestseller',
        image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_2',
        name: 'Peri Peri Fries',
        category: 'Burgers',
        desc: 'Golden crisp crinkle cut potato fries dusted with zesty African bird’s eye seasoning.',
        price: 99,
        badge: 'Popular',
        image: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_3',
        name: 'Margherita Pizza',
        category: 'Pizza',
        desc: 'San Marzano tomato base, hand-torn buffalo mozzarella and aromatic fresh basil.',
        price: 199,
        badge: 'Chef Pick',
        image: 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_4',
        name: 'Creamy Alfredo Pasta',
        category: 'Pasta',
        desc: 'Rich velvety parmesan sauce tossed with penne, garden herbs and cracked pepper.',
        price: 179,
        badge: 'Rich & Creamy',
        image: 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_5',
        name: 'Iced Coffee',
        category: 'Beverages',
        desc: 'Chilled bold cold brew espresso poured over whole milk with mild vanilla sweetness.',
        price: 129,
        badge: 'Chilled',
        image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_6',
        name: 'Paneer Tikka Roll',
        category: 'Indian',
        desc: 'Smoky clay-oven paneer cubes wrapped in layered paratha with mint relish.',
        price: 139,
        badge: 'Spicy',
        image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_7',
        name: 'Warm Chocolate Brownie',
        category: 'Desserts',
        desc: 'Dense Belgian chocolate fudge cake served warm with chocolate drizzle.',
        price: 119,
        badge: 'Sweet Treat',
        image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=500&auto=format&fit=crop'
      },
      {
        id: 'food_8',
        name: 'Masala Chai Flask',
        category: 'Beverages',
        desc: 'Traditional campus style tea brewed slow with freshly crushed cardamom & ginger.',
        price: 69,
        badge: 'Campus Fav',
        image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?q=80&w=500&auto=format&fit=crop'
      }
    ];

    const CATEGORIES = [
      { id: 'All', label: 'All', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>' },
      { id: 'Burgers', label: 'Burgers', icon: '<path d="M4 11h16a1 1 0 0 0 1-1C20.5 5 16.5 2 12 2S3.5 5 3 10a1 1 0 0 0 1 1z"></path><path d="M3 15h18v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2z"></path><line x1="3" y1="13" x2="21" y2="13"></line>' },
      { id: 'Pizza', label: 'Pizza', icon: '<path d="M12 2l9 16.5a2 2 0 0 1-1.73 3H4.73A2 2 0 0 1 3 18.5L12 2z"></path><circle cx="12" cy="12" r="1.5"></circle><circle cx="9" cy="15" r="1"></circle><circle cx="15" cy="15" r="1"></circle>' },
      { id: 'Indian', label: 'Indian', icon: '<path d="M4 11c0 5 4 8 8 8s8-3 8-8H4z"></path><path d="M7 6v2"></path><path d="M12 5v3"></path><path d="M17 6v2"></path>' },
      { id: 'Pasta', label: 'Pasta', icon: '<path d="M3 13c3-3 6 3 9 0s6 3 9 0"></path><path d="M3 17c3-3 6 3 9 0s6 3 9 0"></path><path d="M12 3v5"></path>' },
      { id: 'Beverages', label: 'Beverages', icon: '<path d="M7 3h10l-1.5 16h-7L7 3z"></path><line x1="12" y1="3" x2="12" y2="19"></line>' },
      { id: 'Desserts', label: 'Desserts', icon: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"></path><path d="M4 16s4-1 8 0 8 0 8 0"></path><circle cx="12" cy="6" r="3"></circle>' }
    ];

    // Reactive prototype state

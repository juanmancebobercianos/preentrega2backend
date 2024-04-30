const express = require('express');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = 8080;

const path = require('path');

// Configurar el directorio de vistas
app.set('views', path.join(__dirname, 'src', 'views'));


app.use(express.json());

const productsFilePath = 'productos.json';
const cartFilePath = 'carrito.json';

// Función para leer los datos de un archivo JSON
async function readData(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Si el archivo no existe o hay un error al leerlo, retornar un array vacío
        return [];
    }
}

// Función para escribir los datos en un archivo JSON
async function writeData(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Rutas para productos
app.get('/api/products', async (req, res) => {
    let { limit = 10, page = 1, sort, query, category, availability } = req.query;

    limit = parseInt(limit);
    page = parseInt(page);

    // Leer todos los productos
    let products = await readData(productsFilePath);

    // Aplicar filtro por categoría si se proporciona
    if (category) {
        products = products.filter(product => product.category.toLowerCase() === category.toLowerCase());
    }

    // Aplicar filtro por disponibilidad si se proporciona
    if (availability) {
        const isAvailable = availability.toLowerCase() === 'true';
        products = products.filter(product => product.status === isAvailable);
    }

    // Aplicar filtro por consulta si se proporciona
    if (query) {
        products = products.filter(product => {
            // Aquí implementar la lógica específica del filtro
            // Por ejemplo, si query es un campo específico, filtrar los productos que coincidan con ese campo
            return product.title.toLowerCase().includes(query.toLowerCase());
        });
    }

    // Ordenar si se proporciona sort
    if (sort === 'asc' || sort === 'desc') {
        products.sort((a, b) => {
            if (sort === 'asc') {
                return a.price - b.price;
            } else {
                return b.price - a.price;
            }
        });
    }

    // Aplicar paginación
    const totalProducts = products.length;
    const totalPages = Math.ceil(totalProducts / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedProducts = products.slice(startIndex, endIndex);

    // Construct response object
    const response = {
        status: 'success',
        payload: paginatedProducts,
        totalPages: totalPages,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
        page: page,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
        prevLink: page > 1 ? `${req.protocol}://${req.get('host')}/api/products?limit=${limit}&page=${page - 1}` : null,
        nextLink: page < totalPages ? `${req.protocol}://${req.get('host')}/api/products?limit=${limit}&page=${page + 1}` : null
    };

    res.json(response);
});

// Rutas de vistas
app.get('/products', async (req, res) => {
    try {
        const { limit = 10, page = 1 } = req.query;
        const products = await getPaginatedProducts(limit, page);
        const { prevLink, nextLink } = getPaginationLinks(req, products.totalPages, page);
        res.render('products', { products: products.data, prevLink, nextLink, cartId: 'yourCartId' });
    } catch (error) {
        console.error('Error while fetching products:', error);
        res.status(500).send('Internal Server Error');
    }
});


app.get('/api/products/:pid', async (req, res) => {
    const products = await readData(productsFilePath);
    const productId = req.params.pid;
    const product = products.find(p => p.id === productId);
    if (product) {
        res.json(product);
    } else {
        res.status(404).json({ message: 'Product not found' });
    }
});

app.post('/api/products', async (req, res) => {
    const { title, description, code, price, stock, category, thumbnails } = req.body;
    if (!title || !description || !code || !price || !stock || !category) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const newProduct = {
        id: uuidv4(),
        title,
        description,
        code,
        price,
        status: true,
        stock,
        category,
        thumbnails: thumbnails || []
    };

    let products = await readData(productsFilePath);
    products.push(newProduct);
    await writeData(productsFilePath, products);
    res.status(201).json(newProduct);
});

app.put('/api/products/:pid', async (req, res) => {
    const { title, description, code, price, stock, category, thumbnails } = req.body;
    const productId = req.params.pid;
    let products = await readData(productsFilePath);
    const productIndex = products.findIndex(p => p.id === productId);
    if (productIndex !== -1) {
        products[productIndex] = {
            ...products[productIndex],
            title,
            description,
            code,
            price,
            stock,
            category,
            thumbnails
        };
        await writeData(productsFilePath, products);
        res.json(products[productIndex]);
    } else {
        res.status(404).json({ message: 'Product not found' });
    }
});

app.delete('/api/products/:pid', async (req, res) => {
    const productId = req.params.pid;
    let products = await readData(productsFilePath);
    const productIndex = products.findIndex(p => p.id === productId);
    if (productIndex !== -1) {
        products.splice(productIndex, 1);
        await writeData(productsFilePath, products);
        res.json({ message: 'Product deleted successfully' });
    } else {
        res.status(404).json({ message: 'Product not found' });
    }
});

// Rutas para carritos
app.get('/api/carts/:cid', async (req, res) => {
    const cartId = req.params.cid;
    try {
        let cart = await readData(cartFilePath);
        cart = cart.find(c => c.id === cartId);
        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }
        // Hacer referencia a los productos completos mediante un "populate"
        // Aquí asumimos que cada elemento de la propiedad "products" tiene un campo "productId" que hace referencia al ID del producto en la colección de Products
        const products = await Promise.all(cart.products.map(async cartProduct => {
            const product = await readProductById(cartProduct.productId);
            return { ...cartProduct, product };
        }));
        res.json({ ...cart, products });
    } catch (error) {
        console.error('Error while fetching cart:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.put('/api/carts/:cid', async (req, res) => {
    const cartId = req.params.cid;
    const newProducts = req.body.products;
    try {
        let carts = await readData(cartFilePath);
        const cartIndex = carts.findIndex(c => c.id === cartId);
        if (cartIndex !== -1) {
            carts[cartIndex].products = newProducts;
            await writeData(cartFilePath, carts);
            res.json(carts[cartIndex]);
        } else {
            res.status(404).json({ message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error while updating cart:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.put('/api/carts/:cid/products/:pid', async (req, res) => {
    const cartId = req.params.cid;
    const productId = req.params.pid;
    const { quantity } = req.body;
    try {
        let carts = await readData(cartFilePath);
        const cartIndex = carts.findIndex(c => c.id === cartId);
        if (cartIndex !== -1) {
            const productIndex = carts[cartIndex].products.findIndex(p => p.productId === productId);
            if (productIndex !== -1) {
                carts[cartIndex].products[productIndex].quantity = quantity;
                await writeData(cartFilePath, carts);
                res.json(carts[cartIndex]);
            } else {
                res.status(404).json({ message: 'Product not found in cart' });
            }
        } else {
            res.status(404).json({ message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error while updating cart product quantity:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.delete('/api/carts/:cid/products/:pid', async (req, res) => {
    const cartId = req.params.cid;
    const productId = req.params.pid;
    try {
        let carts = await readData(cartFilePath);
        const cartIndex = carts.findIndex(c => c.id === cartId);
        if (cartIndex !== -1) {
            carts[cartIndex].products = carts[cartIndex].products.filter(p => p.productId !== productId);
            await writeData(cartFilePath, carts);
            res.json({ message: 'Product removed from cart successfully' });
        } else {
            res.status(404).json({ message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error while removing product from cart:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.delete('/api/carts/:cid', async (req, res) => {
    const cartId = req.params.cid;
    try {
        let carts = await readData(cartFilePath);
        const cartIndex = carts.findIndex(c => c.id === cartId);
        if (cartIndex !== -1) {
            carts.splice(cartIndex, 1);
            await writeData(cartFilePath, carts);
            res.json({ message: 'Cart deleted successfully' });
        } else {
            res.status(404).json({ message: 'Cart not found' });
        }
    } catch (error) {
        console.error('Error while deleting cart:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Función para leer un producto por su ID
async function readProductById(productId) {
    const products = await readData(productsFilePath);
    return products.find(product => product.id === productId);
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

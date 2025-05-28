from setuptools import setup, find_packages

setup(
    name="modal_handler",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "litellm>=1.0.0",
        "requests>=2.31.0",
        "aiohttp>=3.9.0",
        "python-dotenv>=1.0.0",
        "typing-extensions>=4.8.0",
        "asyncio>=3.4.3",
        "uuid>=1.30"
    ],
) 
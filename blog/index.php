<?php
// Get all HTML files in the current directory
$files = glob('*.html');

// Sort files alphabetically
sort($files);

// Get current date for footer
$currentDate = date('d-M-Y');

// Function to format file size
function formatSize($bytes) {
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 1) . ' MB';
    } elseif ($bytes >= 1024) {
        return number_format($bytes / 1024, 1) . ' kB';
    } else {
        return $bytes . ' B';
    }
}

// Function to format date
function formatDate($timestamp) {
    return date('d-M-Y H:i', $timestamp);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blog - Austin Hania</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #e8e8e8;
            padding: 40px 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        h1 {
            font-size: 1.75rem;
            font-weight: 400;
            padding: 30px 40px;
            border-bottom: 1px solid #e0e0e0;
            color: #333;
        }

        .file-list {
            padding: 20px 40px 40px;
        }

        .header-row {
            display: grid;
            grid-template-columns: 1fr 120px 200px;
            padding: 15px 10px;
            border-bottom: 1px solid #e0e0e0;
            font-weight: 600;
            font-size: 0.95rem;
            color: #333;
        }

        .file-row {
            display: grid;
            grid-template-columns: 1fr 120px 200px;
            padding: 12px 10px;
            border-bottom: 1px solid #f0f0f0;
            transition: background-color 0.15s;
            align-items: center;
        }

        .file-row:hover {
            background-color: #f8f8f8;
        }

        .file-name {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .file-icon {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .file-name a {
            color: #2563eb;
            text-decoration: none;
            font-size: 0.95rem;
        }

        .file-name a:hover {
            text-decoration: underline;
        }

        .file-size, .file-date {
            color: #666;
            font-size: 0.9rem;
        }

        .parent-dir {
            color: #666;
        }

        .footer {
            padding: 20px 40px;
            border-top: 1px solid #e0e0e0;
            font-size: 0.85rem;
            color: #888;
        }

        .empty-message {
            padding: 40px;
            text-align: center;
            color: #888;
            font-style: italic;
        }

        @media (max-width: 768px) {
            .header-row, .file-row {
                grid-template-columns: 1fr 80px 140px;
            }

            h1 {
                font-size: 1.5rem;
                padding: 20px;
            }

            .file-list {
                padding: 15px 20px 30px;
            }

            .footer {
                padding: 15px 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Index of /blog</h1>
        
        <div class="file-list">
            <div class="header-row">
                <div>Filename</div>
                <div>Size</div>
                <div>Last Modified</div>
            </div>

            <!-- Parent directory link -->
            <div class="file-row">
                <div class="file-name parent-dir">
                    <span class="file-icon">📁</span>
                    <a href="../">..</a>
                </div>
                <div class="file-size">-</div>
                <div class="file-date"><?php echo formatDate(time()); ?></div>
            </div>

            <?php if (empty($files)): ?>
                <div class="empty-message">
                    No blog posts found. Add .html files to this directory.
                </div>
            <?php else: ?>
                <?php foreach ($files as $file): ?>
                    <?php
                    $fileSize = filesize($file);
                    $fileDate = filemtime($file);
                    ?>
                    <div class="file-row">
                        <div class="file-name">
                            <span class="file-icon">📄</span>
                            <a href="<?php echo htmlspecialchars($file); ?>"><?php echo htmlspecialchars($file); ?></a>
                        </div>
                        <div class="file-size"><?php echo formatSize($fileSize); ?></div>
                        <div class="file-date"><?php echo formatDate($fileDate); ?></div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="footer">
            generated by blog-explorer | last updated: <?php echo $currentDate; ?>
        </div>
    </div>
</body>
</html>